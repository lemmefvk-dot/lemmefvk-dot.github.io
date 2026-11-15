/* ============================================================
   arcade/chess.js — Chess for Static Arcade.

   Three ways to play, picked in the Arcade's HUD:
   · 1P: against the computer — Easy, Medium, Hard or Expert, as White
     or Black (both remembered in portal.arcadeChess). Its search runs
     in a Web Worker (./thinker.js → ./think.js) so the page never
     freezes; Undo takes back your last move and its reply. Expert
     (level 4) thinks at most 3 s a move (./chess-rules.js LEVELS).
     Your record at each level (won, lost, drawn) shows under Level and
     in the Arcade's Stats; it counts at the easiest level used.
   · 2P: two people taking turns on one screen (White at the bottom).
   · Online: a friend on another device through the Arcade's room
     (./room.js). The host is White in odd rounds and Black in even
     ones, so a rematch swaps colours. Each side sees its own colour
     at the bottom. Every move that arrives is checked by the rules
     engine before it reaches the board (./boardkit.js duelLink).

   Every rule (./chess-rules.js): castling, en passant, promotion
   (a chooser: Queen, Rook, Bishop, Knight), check, checkmate,
   stalemate, threefold repetition, the 50-move rule and positions
   where nobody can mate. The legal squares of the picked piece are
   marked; move by dragging or by clicking the piece and then its
   square. Keyboard: arrows move a cursor, Enter or Space picks up
   and puts down, Esc lets go, U / Z / Backspace undo, and Q R B N
   answer the promotion chooser.

   Also (1P and 2P):
   · Clocks: off, or 3, 5 or 10 minutes each, starting with the first
     move. Running out loses, unless the other side has too little
     left to ever mate — then it is a draw. Pausing the Arcade stops
     the clocks.
   · Hint: the computer's best move for the side to move (Hard's
     search), marked with an arrow until the next move. A 1P game
     with a hint never sets a best.
   · The move list: click a move to see the board as it was then;
     ← → step, Home / End jump, Esc (or Back to the game) returns.
   · Game file: save the game as standard PGN (to your files, as a
     download, or copied) and load one (from your files, this
     computer, or pasted) — chess-rules.js toPgn / parsePgn.
   · Puzzles: ten mate-in-two positions (./chess-puzzles.js), each
     proven by the rules engine; solved ones are remembered.
   · Board: four themes, coordinates, the legal-move dots and the
     last-move highlight (./boardkit.js boardOptions).

   Score: in 1P, a win scores the number of moves it took (fewer is
   better); a loss or a draw scores nothing. 2P and online games
   never change a best, nor does a game loaded from a file. The
   board is a canvas, so Static Replay can record it.
   ============================================================ */
import { h } from '../core/dom.js';
import { store } from '../core/store.js';
import vfs, { HOME } from '../core/vfs.js';
import { downloadText } from '../core/sysinfo.js';
import {
  Position, WHITE, BLACK, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, F_PROMO, F_CAPTURE, F_CASTLE, START_FEN,
  mFrom, mTo, mPromo, mFlags, sqName, uci, LEVELS, toPgn, parsePgn, pgnDate, isMate, stillMates, hasMatingMaterial,
} from './chess-rules.js';
import { PUZZLES } from './chess-puzzles.js';
import * as records from './records.js';
import { thinker } from './thinker.js';
import { KIT_CSS, surface, ownsKey, sounder, looper, rr, playerStrip, segment, button, confirmButton, duelLink, boardOptions, recordLine, lookOf, escCloser } from './boardkit.js';

const PREF = 'portal.arcadeChess';
/* the board in each theme (./boardkit.js BOARD_THEMES); 'arcade' is the original look */
const THEMES = {
  arcade: { light: '#d6e4da', dark: '#4f8a78', bg: '#07080b', glow: 'hsla(165,80%,40%,.16)', frame: '#0e1412', halo: 'hsla(165,90%,45%,.35)', last: 'rgba(255,214,80,.42)' },
  wood: { light: '#ecd5ab', dark: '#a8734a', bg: '#0d0906', glow: 'hsla(30,80%,40%,.14)', frame: '#2b1b10', halo: 'hsla(30,80%,45%,.3)', last: 'rgba(255,226,120,.45)' },
  paper: { light: '#f6f4ee', dark: '#aab4bf', bg: '#d8d5cc', glow: 'rgba(255,255,255,.35)', frame: '#b8b3a6', halo: 'rgba(0,0,0,.18)', last: 'rgba(255,200,40,.45)' },
  contrast: { light: '#ffffff', dark: '#58708a', bg: '#000000', glow: 'rgba(0,0,0,0)', frame: '#000000', halo: 'rgba(255,255,255,.4)', last: 'rgba(255,190,0,.6)' },
};
const W_FILL = ['#ffffff', '#d8d3ca'], W_INK = '#18151d';
const B_FILL = ['#4a4252', '#141118'], B_INK = '#050407', B_DETAIL = '#d9d0e6';
const MIN_THINK_MS = 350;
const HINT_LEVEL = 3, HINT_MS = 1500;
const CLOCKS = [0, 3, 5, 10];
const NAMES = { [PAWN]: 'pawn', [KNIGHT]: 'knight', [BISHOP]: 'bishop', [ROOK]: 'rook', [QUEEN]: 'queen', [KING]: 'king' };
const VALUE = [0, 1, 3, 3, 5, 9, 0];
const REASON = {
  checkmate: 'checkmate', stalemate: 'stalemate', threefold: 'threefold repetition', fifty: 'the 50-move rule',
  material: 'too little material to mate', resign: 'resignation', time: 'time',
  'time-material': 'time, with too little left to mate',
};
const ARROWS = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
const colorName = c => (c === WHITE ? 'White' : 'Black');
const ci = c => (c === WHITE ? 0 : 1);

const CSS = `
.arx-ch__mv{font:inherit;color:inherit;background:none;border:0;padding:0 4px;margin:0 -4px;border-radius:5px;text-align:left;cursor:pointer;justify-self:start}
.arx-ch__mv:focus-visible{outline:2px solid hsl(var(--h) 100% 72%);outline-offset:1px}
@media (hover:hover){.arx-ch__mv:hover{background:var(--fill-2);color:var(--ink-0)}}
.arx-ch__mv.is-view{background:hsl(var(--h) 80% 50% / .3);color:var(--ink-0)}
.arx-ch__review{display:flex;align-items:center;gap:4px;padding:5px 6px;border-radius:var(--r-md,11px);background:hsl(var(--h) 60% 40% / .14);border:1px solid hsl(var(--h) 80% 60% / .3)}
.arx-ch__review[hidden]{display:none}
.arx-ch__review span{flex:1;min-width:0;text-align:center;font-size:var(--fs-12,12px);font-weight:650;color:var(--ink-0);white-space:nowrap}
.arx-ch__review .arx-bg__btn{flex:0 0 auto;padding:0 8px}
.arx-ch__dlg h4{margin:6px 0 2px;font-size:var(--fs-12,12px);color:var(--ink-2);text-transform:uppercase;letter-spacing:.5px}
.arx-ch__dlg textarea{width:100%;min-height:72px;resize:vertical;padding:7px 8px;border-radius:8px;border:1px solid var(--line-2);background:var(--fill-0);color:var(--ink-0);font:500 var(--fs-12,12px)/1.4 var(--mono,ui-monospace,monospace)}
.arx-ch__files{display:flex;flex-direction:column;gap:4px;max-height:132px;overflow:auto}
.arx-ch__files .arx-bg__btn{justify-content:flex-start;flex:0 0 auto}
.arx-ch__msg{min-height:1.4em;margin:2px 0 0;font-size:var(--fs-12,12px);color:var(--ink-1)}
.arx-ch__msg.is-bad{color:#ffb3bf}
.arx-ch__pz{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}
.arx-ch__pz button{height:44px;border-radius:10px;border:1px solid var(--line-1);background:var(--fill-0);color:var(--ink-1);font:700 var(--fs-13,13px)/1 var(--font,system-ui);cursor:pointer}
.arx-ch__pz button.is-done{border-color:hsl(140 70% 55% / .7);color:#c9ffd9;background:hsl(140 60% 30% / .25)}
.arx-ch__pz button:focus-visible{outline:2px solid hsl(var(--h) 100% 72%);outline-offset:2px}
`;

const readPrefs = () => {
  let p = null;
  try { p = store.get(PREF, null); } catch (err) { p = null; }
  return {
    level: [1, 2, 3, 4].includes(p?.level) ? p.level : 2, side: p?.side === 'b' ? 'b' : 'w',
    clock: CLOCKS.includes(p?.clock) ? p.clock : 0,
    solved: Array.isArray(p?.solved) ? p.solved.filter(x => typeof x === 'string') : [],
    ...lookOf(p, { coords: true, dots: true, last: true }),
  };
};
const writePrefs = patch => { try { store.set(PREF, { ...readPrefs(), ...patch }); } catch (err) { /* a convenience */ } };
/* 4:59 · 0:42 · 9.4 (tenths in the last ten seconds) */
const clockText = ms => {
  const t = Math.max(0, ms);
  if (t < 10000) return (Math.floor(t / 100) / 10).toFixed(1);
  const s = Math.ceil(t / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export default {
  mount(el, ctx) {
    const NET = ctx.online && typeof ctx.online.send === 'function' ? ctx.online : null;
    const mode = NET ? 'online' : ctx.players === 2 ? '2p' : 'cpu';
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    /* the computer's moves and the hints (2P has hints too); the worker starts on the first question */
    const brain = mode !== 'online' ? thinker() : null;
    const prefs = readPrefs();
    const host = NET?.role === 'host';
    const round = Number.isInteger(NET?.round) ? NET.round : 1;
    const peerName = String(NET?.peer?.name || 'Friend');
    let me = mode === 'online' ? ((round % 2 === 1) === host ? WHITE : BLACK) : mode === 'cpu' ? (prefs.side === 'b' ? BLACK : WHITE) : WHITE;
    let flipped = mode !== '2p' && me === BLACK;
    let dead = false;

    const S = {
      pos: new Position(), keys: [], hist: [], last: null, startFen: START_FEN,
      sel: -1, targets: [], cursor: 0, kb: false, hover: -1,
      drag: null, anims: [], over: null, ended: false, endT: 0,
      thinking: false, thinkId: 0, promo: null,
      level: prefs.level, lowest: prefs.level, myMoves: 0, rejected: 0, geo: { x: 0, y: 0, sq: 0 },
      look: { theme: prefs.theme, coords: prefs.coords, dots: prefs.dots, last: prefs.last },
      hint: null, hints: 0, hintBusy: false, hintId: 0,
      view: null, viewCache: null,
      clockMin: mode === 'online' ? 0 : prefs.clock, left: [0, 0], run: 0, runAt: 0, paused: false,
      loaded: null, puzzle: null, wait: 0,
    };
    /* the person's colour now: a puzzle is always White to move */
    const mine = () => (S.puzzle ? WHITE : me);
    const them = () => -mine();

    /* ------------------------------ the page ------------------------------ */
    const boardEl = h('div.arx-bg__board');
    const sr = h('div.arx-bg__sr', { 'aria-live': 'polite' });
    const statusEl = h('div.arx-bg__status', { role: 'status' });
    const topStrip = playerStrip('#888', '', '');
    const botStrip = playerStrip('#fff', '', '');
    const movesEl = h('ol.arx-bg__moves', { 'aria-label': 'Moves — choose one to see the board as it was', dataset: { empty: 'No moves yet' } });
    const levelSeg = mode === 'cpu' ? segment('Level', [1, 2, 3, 4].map(id => ({ id, label: LEVELS[id].name, title: id === 4 ? 'Thinks up to 3 seconds a move' : null })), S.level, setLevel) : null;
    const sideSeg = mode === 'cpu' ? segment('Play as', [{ id: 'w', label: 'White' }, { id: 'b', label: 'Black', title: 'The computer moves first' }], prefs.side, setSide) : null;
    const clockSeg = mode !== 'online' ? segment('Clock', CLOCKS.map(m => ({ id: m, label: m ? `${m} min` : 'Off', title: m ? `${m} minutes each, from the first move` : 'No clock' })), S.clockMin, setClock) : null;
    const recLine = mode === 'cpu' ? recordLine() : null;
    const undoBtn = mode !== 'online' ? button('Undo', 'corner-up-left', () => { undo(); refocus(); }, { title: mode === 'cpu' ? 'Take back your last move and the computer’s reply (U)' : 'Take back the last move (U)' }) : null;
    const resignBtn = mode !== '2p' ? confirmButton('Resign', 'Resign? Click again', 'x', () => { resign(); refocus(); }) : null;
    const hintBtn = mode !== 'online' ? button('Hint', 'sparkles', () => { hint(); }, { title: 'Show a good move for the side to move' }) : null;
    const opts = boardOptions(boardEl, {
      samples: Object.fromEntries(Object.entries(THEMES).map(([k, t]) => [k, [t.light, t.dark]])),
      coords: true,
      toggles: [{ id: 'dots', label: 'Legal-move dots', note: 'Where the picked piece can go' }, { id: 'last', label: 'Last move', note: 'The squares the last move came from and went to' }],
      get: () => ({ ...S.look }),
      set: (k, v) => { S.look[k] = v; writePrefs({ [k]: v }); draw(); },
      refocus: () => refocus(),
    });
    const fileBtn = button('Game file', 'file-text', () => openFile(), { title: 'Save this game as PGN, or load one', 'aria-haspopup': 'dialog' });
    const puzzleBtn = mode !== 'online' ? button('Puzzles', 'star', () => openPuzzles(), { title: 'Ten mate-in-two puzzles', 'aria-haspopup': 'dialog' }) : null;
    /* reviewing an earlier move */
    const revPos = h('span', { text: '' });
    const revBtn = (label, ic, fn, title) => { const b = button(label, ic, fn, { title, 'aria-label': title }); return b; };
    const reviewBar = h('div.arx-ch__review', { hidden: true, role: 'group', 'aria-label': 'Reviewing the game' },
      revBtn('', 'skip-back', () => viewAt(0), 'The start (Home)'), revBtn('', 'chevron-left', () => step(-1), 'One move back (←)'),
      revPos, revBtn('', 'chevron-right', () => step(1), 'One move on (→)'), revBtn('', 'skip-forward', () => viewAt(S.hist.length), 'The last move (End)'),
      button('Back', 'corner-up-left', () => { live(); refocus(); }, { title: 'Back to the game (Esc)', dataset: { k: 'live' } }));
    /* the puzzle's own buttons */
    const pzPrev = button('Previous', 'chevron-left', () => startPuzzle(S.puzzle.i - 1));
    const pzRetry = button('Try again', 'rotate-ccw', () => startPuzzle(S.puzzle.i));
    const pzNext = button('Next', 'chevron-right', () => startPuzzle(S.puzzle.i + 1));
    const pzLeave = button('Leave puzzles', 'x', () => leavePuzzles());
    const pzRow = h('div.arx-bg__row', { hidden: true, dataset: { k: 'puzzle' } }, pzPrev, pzRetry, pzNext, pzLeave);
    const note = mode === 'online'
      ? h('div.arx-bg__note', { text: 'Every move is checked against the rules on both screens. No clock — take your time.' })
      : mode === '2p' ? h('div.arx-bg__note', { text: 'Two players on this screen: take turns. White is at the bottom.' }) : null;
    const playRow = h('div.arx-bg__row', undoBtn, hintBtn, resignBtn);
    const toolRow = h('div.arx-bg__row', opts.button, fileBtn, puzzleBtn);
    const side = h('div.arx-bg__side',
      topStrip.el, statusEl, reviewBar, levelSeg?.el, sideSeg?.el, clockSeg?.el, recLine?.el, movesEl,
      playRow, pzRow, toolRow, note, botStrip.el);
    const root = h('div.arx-bgc', { style: { '--ga': ctx.accent || 'var(--accent)' } }, h('style', { text: KIT_CSS + CSS }), h('div.arx-bg', boardEl, side), sr);
    el.appendChild(root);
    const sf = surface(boardEl, 'Chess board', () => draw());
    const loop = looper(() => draw());
    const refocus = () => el.closest('[tabindex]')?.focus({ preventScroll: true });
    let dlg = null, offEsc = null;       /* the Game file or Puzzles card, when open */

    const link = NET ? duelLink(NET, {
      plies: () => S.hist.length,
      mine: i => S.hist[i]?.by === 'me',
      wire: i => ({ u: S.hist[i].uci }),
      take: d => {
        if (S.over) return false;
        if (S.pos.turn !== them() || typeof d.u !== 'string' || d.u.length > 5) return false;
        const m = S.pos.fromUci(d.u);
        if (!m) return false;
        apply(m, 'peer');
        return true;
      },
      reject: () => { S.rejected++; },
      resigned: () => {
        if (S.over) return;
        S.over = { over: true, winner: me, reason: 'resign', who: 'them' };
        say(`${peerName} resigned.`);
        ctx.announce?.(`${peerName} resigned.`);
        paint();
        finishSoon();
      },
      dead: () => dead,
    }) : null;

    /* ------------------------------ rules glue ------------------------------ */
    function reset(fen = START_FEN) {
      if (brain) brain.cancel();
      clearTimeout(S.endT);
      clearTimeout(S.wait);
      S.startFen = fen;
      S.pos = new Position(fen);
      S.keys = [S.pos.key()];
      S.hist = []; S.last = null; S.sel = -1; S.targets = []; S.anims = []; S.over = null; S.ended = false;
      S.thinking = false; S.thinkId++; S.myMoves = 0; S.drag = null; S.lowest = S.level;
      S.hint = null; S.hints = 0; S.hintBusy = false; S.hintId++; S.view = null; S.viewCache = null; S.wait = 0;
      S.loaded = null;
      clockReset();
      closePromo();
    }
    function newGame() {
      closeDlg();
      S.puzzle = null;
      reset();
      flipped = mode !== '2p' && me === BLACK;
      S.cursor = mode === '2p' || me === WHITE ? 0x14 : 0x64;          /* e2 / e7 */
      ctx.onScore(0);
      NET?.peerScore?.(0);
      paint();
      if (mode === 'cpu' && S.pos.turn !== me) computerMove();
    }

    const canAct = () => !dead && !S.over && !S.promo && !S.thinking && !S.wait && S.view === null && !dlg && !opts.isOpen()
      && (S.puzzle ? S.pos.turn === WHITE : mode === '2p' || S.pos.turn === me);
    const moverColor = () => (S.puzzle ? WHITE : mode === '2p' ? S.pos.turn : me);
    const isOwn = sq => { const p = S.pos.piece(sq); return p !== 0 && Math.sign(p) === moverColor() && S.pos.turn === moverColor(); };
    function select(sq) {
      S.sel = sq;
      S.targets = S.pos.legalMoves().filter(m => mFrom(m) === sq);
    }
    function clearSel() { S.sel = -1; S.targets = []; paint(); }

    function tryMove(from, to, { dropped = false } = {}) {
      const cands = S.pos.legalMoves().filter(m => mFrom(m) === from && mTo(m) === to);
      if (!cands.length) return false;
      if (cands.some(m => mFlags(m) & F_PROMO)) { openPromo(from, to); return true; }
      playMine(cands[0], !dropped);
      return true;
    }
    function playMine(m, animate = true) {
      apply(m, 'me', animate);
      if (link) link.sendMove(S.hist.length - 1);
    }

    function apply(m, by, animate = true) {
      const pos = S.pos;
      const from = mFrom(m), to = mTo(m), flags = mFlags(m);
      const mover = pos.turn;
      const san = pos.san(m);
      clockMoved(mover);
      pos.make(m);
      S.keys.push(pos.key());
      S.hist.push({ m, san, uci: uci(m), by, color: mover });
      S.last = { from, to };
      S.sel = -1; S.targets = [];
      S.hint = null; S.hintId++; S.hintBusy = false;
      S.viewCache = null;
      if (by === 'me') S.myMoves++;
      S.anims = [];
      if (animate && !reduced) {
        const t0 = performance.now();
        S.anims.push({ piece: pos.b[to], from, to, t0, dur: 170 });
        if (flags & F_CASTLE) {
          const rf = to > from ? from + 3 : from - 4, rt = to > from ? from + 1 : from - 1;
          S.anims.push({ piece: pos.b[rt], from: rf, to: rt, t0, dur: 170 });
        }
        loop.kick(0.2);
      }
      const o = pos.outcome(S.keys);
      if (o.over) { S.over = o; clockStop(); }
      if (pos.inCheck()) snd.blip(660, 0.12, 'triangle', 0.9, 990);
      else if (flags & F_CAPTURE) snd.blip(220, 0.09, 'square', 0.6, 140);
      else snd.blip(420, 0.05, 'triangle', 0.6);
      const who = mode === '2p' ? colorName(mover) : by === 'me' ? 'You' : mode === 'cpu' ? 'The computer' : peerName;
      const told = `${who} played ${spoken(san)}.${o.over && !S.puzzle ? ' ' + overText() : pos.inCheck() ? ' Check.' : ''}`;
      say(told);
      /* the other side's move, for a screen reader (the shell's live region): yours you just made */
      if (by !== 'me' || mode === '2p') ctx.announce?.(told);
      paint();
      if (S.puzzle) { puzzleStep(by); return; }
      if (S.over) finishSoon();
      else if (mode === 'cpu' && pos.turn !== me) computerMove();
    }

    async function computerMove() {
      const id = ++S.thinkId;
      S.thinking = true;
      paint();
      const t0 = performance.now();
      const res = await brain.ask({ game: 'chess', fen: S.pos.fen(), history: S.keys.slice(0, -1), level: S.level });
      if (dead || id !== S.thinkId) return;
      const wait = MIN_THINK_MS - (performance.now() - t0);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      if (dead || id !== S.thinkId || S.over) return;
      S.thinking = false;
      const m = res && res.move ? S.pos.fromUci(res.move) : 0;
      if (!m) {
        statusEl.textContent = 'The computer could not move. Press Undo or start again.';
        statusEl.classList.add('is-alert');
        return;
      }
      apply(m, 'cpu');
    }

    function takeBack() {
      S.pos.unmake();
      S.keys.pop();
      const x = S.hist.pop();
      if (x?.by === 'me') S.myMoves--;
    }
    function undo() {
      if (mode === 'online' || S.over || S.promo || dead || S.puzzle) return;
      const floor = S.loaded ? S.loaded.plies : 0;            /* a loaded game's own moves stay */
      if (mode === '2p') {
        if (S.hist.length <= floor) return;
        takeBack();
      } else {
        let mine = -1;
        for (let i = S.hist.length - 1; i >= floor; i--) if (S.hist[i].by === 'me') { mine = i; break; }
        if (mine < 0) return;
        if (S.thinking) { brain.cancel(); S.thinkId++; S.thinking = false; }
        while (S.hist.length > mine) takeBack();
      }
      const lastMove = S.hist[S.hist.length - 1];
      S.last = lastMove ? { from: mFrom(lastMove.m), to: mTo(lastMove.m) } : null;
      S.sel = -1; S.targets = []; S.anims = []; S.hint = null; S.hintId++; S.hintBusy = false; S.view = null; S.viewCache = null;
      clockUndone();
      snd.blip(330, 0.07, 'triangle', 0.6, 220);
      say('Move taken back.');
      paint();
    }

    function resign() {
      if (S.over || dead || S.puzzle) return;
      if (S.thinking) { brain?.cancel(); S.thinkId++; S.thinking = false; }
      closePromo();
      clockStop();
      S.over = { over: true, winner: mode === '2p' ? -S.pos.turn : them(), reason: 'resign', who: 'me' };
      link?.resign();
      say('You resigned.');
      paint();
      finishSoon();
    }

    function finishSoon() {
      clearTimeout(S.endT);
      S.endT = setTimeout(finish, reduced ? 300 : 900);
    }
    function finish() {
      if (S.ended || dead || !S.over || S.puzzle) return;
      S.ended = true;
      paint();
      const o = S.over, moves = Math.ceil(S.hist.length / 2);
      const how = REASON[o.reason] || o.reason;
      if (mode === 'online') {
        const won = o.winner === 0 ? null : o.winner === me;
        const detail = o.reason === 'resign' ? (o.who === 'me' ? 'You resigned.' : `${peerName} resigned.`)
          : o.winner === 0 ? `Draw by ${how}, after ${moves} moves.` : `By checkmate, after ${moves} moves. You played ${colorName(me)}.`;
        ctx.onEnd({ score: null, won, versus: { me: won === null ? 0.5 : won ? 1 : 0, them: won === null ? 0.5 : won ? 0 : 1 }, detail });
        return;
      }
      const extra = (S.hints ? ` ${S.hints === 1 ? 'One hint' : `${S.hints} hints`} used.` : '') + (S.loaded ? ' Played on from a loaded game.' : '');
      if (mode === '2p') {
        ctx.onEnd({ score: null, detail: (o.winner === 0 ? `Draw by ${how}.` : `${colorName(o.winner)} wins by ${how}, after ${moves} moves.`) + extra });
        return;
      }
      const lv = LEVELS[S.lowest].name;
      const result = o.winner === me ? 'win' : o.winner === 0 ? 'draw' : 'loss';
      /* a game carried on from a file isn't this person's whole game: no record, no best */
      const vs = S.loaded ? null : { key: String(S.lowest), label: lv, result };
      const assisted = S.hints > 0 || !!S.loaded;
      const end = { won: result === 'win', ...(vs ? { vs } : {}), ...(assisted ? { assisted: true } : {}) };
      if (result === 'win') ctx.onEnd({ ...end, score: S.myMoves, detail: `${o.reason === 'checkmate' ? 'Checkmate' : `A win on ${how}`} in ${S.myMoves} moves against the computer (${lv}).${extra}` });
      else if (result === 'draw') ctx.onEnd({ ...end, score: null, detail: `Draw by ${how} against the computer (${lv}).${extra}` });
      else ctx.onEnd({ ...end, score: null, detail: (o.reason === 'resign' ? `You resigned against the computer (${lv}).` : o.reason === 'time' ? `Your time ran out against the computer (${lv}).` : `Checkmate — the computer (${lv}) wins.`) + extra });
      paintRecord();
    }

    function setLevel(v) {
      S.level = v;
      if (S.hist.length) S.lowest = Math.min(S.lowest, v); else S.lowest = v;
      writePrefs({ level: v });
      levelSeg.set(v);
      paint();
      refocus();
    }
    function setSide(v) {
      writePrefs({ side: v });
      sideSeg.set(v);
      me = v === 'b' ? BLACK : WHITE;
      newGame();
      refocus();
    }
    function setClock(v) {
      S.clockMin = v;
      writePrefs({ clock: v });
      clockSeg.set(v);
      if (S.puzzle) { paint(); refocus(); return; }
      newGame();
      say(v ? `A new game with ${v} minutes each. The clocks start with the first move.` : 'A new game without a clock.');
      refocus();
    }
    function paintRecord() {
      if (!recLine) return;
      recLine.set(records.vsOf('chess', String(S.level)), LEVELS[S.level].name);
    }

    /* ------------------------------ clocks ------------------------------ */
    const clockOn = () => S.clockMin > 0 && !S.puzzle && mode !== 'online';
    function clockReset() { S.left = [S.clockMin * 60000, S.clockMin * 60000]; S.run = 0; S.runAt = 0; }
    /* time spent so far by the side whose clock runs */
    const spent = () => (S.run && !S.paused ? performance.now() - S.runAt : 0);
    const leftOf = c => S.left[ci(c)] - (S.run === c ? spent() : 0);
    function clockMoved(mover) {
      if (!clockOn()) return;
      if (S.run === mover) S.left[ci(mover)] -= spent();
      S.run = -mover;
      S.runAt = performance.now();
    }
    function clockStop() {
      if (S.run) S.left[ci(S.run)] -= spent();
      S.run = 0;
    }
    function clockUndone() {
      if (!clockOn()) return;
      if (S.run) S.left[ci(S.run)] -= spent();
      S.run = S.hist.length ? S.pos.turn : 0;
      S.runAt = performance.now();
    }
    function flag(c) {
      clockStop();
      S.left[ci(c)] = 0;
      if (S.thinking) { brain?.cancel(); S.thinkId++; S.thinking = false; }
      closePromo();
      const winner = hasMatingMaterial(S.pos, -c) ? -c : 0;
      S.over = { over: true, winner, reason: winner ? 'time' : 'time-material' };
      const t = `${colorName(c)}’s time ran out. ${overText()}`;
      say(t);
      ctx.announce?.(t);
      paint();
      finishSoon();
    }
    const ticker = setInterval(() => {
      if (dead || !clockOn()) return;
      if (S.run && !S.over && leftOf(S.run) <= 0) { flag(S.run); return; }
      paintClocks();
    }, 100);
    function paintClocks() {
      const topColor = mode === '2p' ? BLACK : them(), botColor = mode === '2p' ? WHITE : me;
      if (!clockOn()) { topStrip.set({ clock: null }); botStrip.set({ clock: null }); return; }
      const t = leftOf(topColor), b = leftOf(botColor);
      topStrip.set({ clock: clockText(t), low: t < 20000 });
      botStrip.set({ clock: clockText(b), low: b < 20000 });
    }

    /* ------------------------------ hints ------------------------------ */
    async function hint() {
      if (!brain || !canAct() || S.hintBusy || S.puzzle) return;
      const id = ++S.hintId;
      S.hintBusy = true;
      paint();
      const res = await brain.ask({ game: 'chess', fen: S.pos.fen(), history: S.keys.slice(0, -1), level: HINT_LEVEL, timeMs: HINT_MS });
      if (dead || id !== S.hintId) return;
      S.hintBusy = false;
      const m = res && res.move ? S.pos.fromUci(res.move) : 0;
      if (!m) { say('No hint this time.'); paint(); return; }
      S.hint = { from: mFrom(m), to: mTo(m), san: S.pos.san(m) };
      S.hints++;
      const t = `Hint: ${spoken(S.hint.san)}.`;
      say(t);
      ctx.announce?.(t);
      paint();
      refocus();
    }

    /* ------------------------------ review ------------------------------ */
    /* the board as it was after n moves (n = S.hist.length is now) */
    function viewPos() {
      if (S.view === null) return S.pos;
      if (S.viewCache?.n === S.view) return S.viewCache.pos;
      const p = new Position(S.startFen);
      for (let i = 0; i < S.view; i++) p.make(S.hist[i].m);
      S.viewCache = { n: S.view, pos: p };
      return p;
    }
    function viewAt(n) {
      const k = Math.max(0, Math.min(S.hist.length, n));
      if (k === S.hist.length && S.view !== null) { live(); return; }
      if (k === S.hist.length) return;
      S.view = k;
      S.sel = -1; S.targets = []; S.drag = null;
      const t = k === 0 ? 'The start position.' : `After move ${Math.ceil(k / 2)}${k % 2 ? '' : '…'}: ${spoken(S.hist[k - 1].san)}.`;
      say(t);
      paint();
    }
    function step(d) { viewAt((S.view === null ? S.hist.length : S.view) + d); }
    function live() {
      if (S.view === null) return;
      S.view = null;
      say('Back to the game.');
      paint();
    }

    /* ------------------------------ promotion ------------------------------ */
    function openPromo(from, to) {
      closePromo();
      const color = moverColor();
      const pick = t => () => { choosePromo(t); };
      const btns = [QUEEN, ROOK, BISHOP, KNIGHT].map(t => {
        const cv = document.createElement('canvas');
        cv.width = 88; cv.height = 88;
        const g = cv.getContext('2d');
        g.scale(0.88, 0.88);
        drawPiece(g, t, color === WHITE, 0, 0, 100);
        const label = NAMES[t][0].toUpperCase() + NAMES[t].slice(1);
        return h('button.arc-ov__btn', { type: 'button', dataset: { piece: 'pnbrqk'[t - 1] }, title: `${label} (${'PNBRQK'[t - 1]})`, onclick: pick(t) }, cv, h('span', { text: label }));
      });
      const cancel = h('button.arc-ov__btn', { type: 'button', onclick: () => { closePromo(); paint(); refocus(); } }, h('span', { text: 'Cancel' }));
      const ov = h('div.arx-bg__promo', { role: 'dialog', 'aria-label': 'Promote the pawn to' },
        h('div.arc-ov__card',
          h('div.arc-ov__big.arc-ov__big--sm', { text: 'Promote to' }),
          h('div.arc-ov__row', btns),
          h('div.arc-ov__row', cancel),
          h('p.arc-ov__text', { text: 'Keys: Q, R, B or N. Esc cancels.' })));
      boardEl.appendChild(ov);
      S.promo = { from, to, el: ov };
      setTimeout(() => { if (S.promo?.el === ov) btns[0].focus({ preventScroll: true }); }, 30);
      paint();
    }
    function choosePromo(t) {
      const p = S.promo;
      if (!p) return;
      closePromo();
      const m = S.pos.findMove(p.from, p.to, t);
      if (m) playMine(m);
      refocus();
    }
    function closePromo() {
      if (!S.promo) return;
      S.promo.el.remove();
      S.promo = null;
    }

    /* ------------------------------ cards over the board ------------------------------ */
    function openDlg(label, ...kids) {
      closeDlg();
      dlg = h('div.arx-bg__dlg.arx-ch__dlg', {
        role: 'dialog', 'aria-modal': 'true', 'aria-label': label,
        onpointerdown: e => { if (e.target === dlg) closeDlg(true); },
        onkeydown: e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); closeDlg(true); } },
      }, h('div.arc-ov__card', ...kids));
      boardEl.appendChild(dlg);
      offEsc = escCloser(boardEl, () => closeDlg(true));
      setTimeout(() => dlg?.querySelector('button,textarea')?.focus({ preventScroll: true }), 30);
      paint();
      return dlg;
    }
    function closeDlg(back = false) {
      if (!dlg) return;
      offEsc?.(); offEsc = null;
      dlg.remove();
      dlg = null;
      paint();
      if (back) refocus();
    }

    /* ------------------------------ the game file (PGN) ------------------------------ */
    const RESULT = o => (!o ? '*' : o.winner === WHITE ? '1-0' : o.winner === BLACK ? '0-1' : '1/2-1/2');
    function pgnText() {
      const names = mode === 'cpu' ? { me: 'You', them: `Computer (${LEVELS[S.level].name})` } : mode === 'online' ? { me: 'You', them: peerName } : null;
      const tags = S.loaded?.tags ? { ...S.loaded.tags } : {
        Event: S.puzzle ? 'Static Arcade puzzle' : mode === '2p' ? 'Static Arcade, two players' : mode === 'online' ? 'Static Arcade, online' : 'Static Arcade',
        Site: 'StaticOS', Date: pgnDate(), Round: '-',
        White: names ? (me === WHITE ? names.me : names.them) : 'Player 1', Black: names ? (me === BLACK ? names.me : names.them) : 'Player 2',
      };
      tags.Result = RESULT(S.over);
      if (clockOn() && !S.loaded) tags.TimeControl = String(S.clockMin * 60);
      if (S.over?.reason === 'time' || S.over?.reason === 'time-material') tags.Termination = 'time forfeit';
      return toPgn({ tags, fen: S.startFen, sans: S.hist.map(x => x.san) });
    }
    const fileName = () => {
      const d = new Date(), p = n => String(n).padStart(2, '0');
      return `Chess ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.pgn`;
    };
    const DIR = `${HOME}/Games/Chess`;
    function pgnFiles() {
      const out = [];
      try { vfs.walk(HOME, (n, path) => { if (n.type === 'file' && /\.pgn$/i.test(n.name)) out.push({ path, name: n.name, at: Date.parse(n.mtime || '') || 0 }); }, 6); } catch (err) { /* no files */ }
      return out.sort((a, b) => b.at - a.at).slice(0, 8);
    }
    function openFile() {
      const msg = h('p.arx-ch__msg', { role: 'status', dataset: { k: 'msg' } });
      const tell = (t, bad = false) => { msg.textContent = t; msg.classList.toggle('is-bad', bad); };
      const save = button('Save to Files', 'save', () => {
        try {
          if (!vfs.node(`${HOME}/Games`)) vfs.mkdir(`${HOME}/Games`);
          if (!vfs.node(DIR)) vfs.mkdir(DIR);
          const name = fileName();
          vfs.write(`${DIR}/${name}`, pgnText());
          tell(`Saved as Games › Chess › ${name} in your files.`);
        } catch (err) { tell('It couldn’t be saved to your files.', true); }
      }, { dataset: { k: 'save' } });
      const down = button('Download', 'download', () => { downloadText(fileName(), pgnText(), 'application/x-chess-pgn'); tell('Downloaded as a .pgn file.'); }, { dataset: { k: 'download' } });
      const copy = button('Copy', 'copy', async () => {
        try { await navigator.clipboard.writeText(pgnText()); tell('Copied as PGN text.'); } catch (err) { tell('Copying isn’t allowed here; use Download instead.', true); }
      }, { dataset: { k: 'copy' } });
      const files = pgnFiles();
      const list = h('div.arx-ch__files', files.length ? files.map(f => button(f.name, 'file-text', () => {
        const text = vfs.read(f.path);
        if (text == null) { tell('That file can’t be read.', true); return; }
        load(text, tell);
      }, { title: f.path, dataset: { file: f.name } })) : h('p.arx-ch__msg', { text: 'No .pgn files in your files yet.' }));
      const input = h('input', { type: 'file', accept: '.pgn,text/plain,application/x-chess-pgn', hidden: true, 'aria-label': 'Open a PGN file from this computer' });
      input.addEventListener('change', async () => {
        const f = input.files?.[0];
        if (!f) return;
        if (f.size > 400000) { tell('That file is too big for a chess game.', true); return; }
        try { load(await f.text(), tell); } catch (err) { tell('That file can’t be read.', true); }
        input.value = '';
      });
      const pick = button('From this computer…', 'folder-open', () => input.click(), { dataset: { k: 'pick' } });
      const area = h('textarea', { 'aria-label': 'PGN text', placeholder: '[Event "…"]\n\n1. e4 e5 2. Nf3 …', spellcheck: 'false' });
      const paste = button('Load this text', 'upload', () => load(area.value, tell), { dataset: { k: 'paste' } });
      const close = h('button.arc-ov__btn.is-primary', { type: 'button', onclick: () => closeDlg(true) }, h('span', { text: 'Done' }));
      openDlg('Game file',
        h('h3', { text: 'Game file (PGN)' }),
        h('p.arc-ov__text', { text: 'PGN is the usual way to keep a chess game: any chess program can open it.' }),
        h('h4', { text: 'Save this game' }), h('div.arx-bg__row', save, down, copy),
        h('h4', { text: 'Load a game' }), list, h('div.arx-bg__row', pick, input), area, h('div.arx-bg__row', paste),
        msg, h('div.arc-ov__row', close));
    }
    /* a game from PGN text: its moves on the board, then play on from the end */
    function load(text, tell) {
      let g;
      try { g = parsePgn(text); } catch (err) { tell(err.message, true); return; }
      S.puzzle = null;
      try { reset(g.fen); } catch (err) { tell('Its start position can’t be used.', true); return; }
      for (const u of g.uci) {
        const m = S.pos.fromUci(u);
        if (!m) { tell('One of its moves can’t be played.', true); reset(); paint(); return; }
        const san = S.pos.san(m);
        S.pos.make(m);
        S.keys.push(S.pos.key());
        S.hist.push({ m, san, uci: u, by: 'loaded', color: -S.pos.turn });
      }
      S.loaded = { tags: g.tags, plies: S.hist.length };
      const lastMove = S.hist[S.hist.length - 1];
      S.last = lastMove ? { from: mFrom(lastMove.m), to: mTo(lastMove.m) } : null;
      flipped = mode !== '2p' && me === BLACK;
      const o = S.pos.outcome(S.keys);
      const who = [g.tags.White, g.tags.Black].filter(x => x && x !== '?').join(' – ');
      closeDlg();
      if (o.over) {
        /* a finished game is there to look through, from its first move */
        S.over = o;
        S.ended = true;
        paint();
        viewAt(0);
        say(`Loaded ${who || 'a game'}: ${S.hist.length} moves, finished by ${REASON[o.reason] || o.reason}. Use the move list or ← → to go through it.`);
      } else {
        paint();
        say(`Loaded ${who || 'a game'}: ${S.hist.length} moves. ${colorName(S.pos.turn)} to move — play on${mode === 'cpu' ? `; you are ${colorName(me)}` : ''}.`);
        if (mode === 'cpu' && S.pos.turn !== me) computerMove();
      }
      refocus();
    }

    /* ------------------------------ puzzles ------------------------------ */
    function openPuzzles() {
      const solved = new Set(readPrefs().solved);
      const btns = PUZZLES.map((p, i) => h('button', { type: 'button', class: solved.has(p.id) ? 'is-done' : '', dataset: { puzzle: p.id },
        'aria-label': `Puzzle ${i + 1}${solved.has(p.id) ? ', solved' : ''}`, onclick: () => startPuzzle(i) }, `${i + 1}${solved.has(p.id) ? ' ✓' : ''}`));
      const close = h('button.arc-ov__btn', { type: 'button', onclick: () => closeDlg(true) }, h('span', { text: 'Close' }));
      openDlg('Puzzles',
        h('h3', { text: 'Mate in two' }),
        h('p.arc-ov__text', { text: `White to move and mate in two, whatever Black does. ${solved.size} of ${PUZZLES.length} solved on this device.` }),
        h('div.arx-ch__pz', btns),
        h('div.arc-ov__row', close));
    }
    function startPuzzle(i) {
      const k = (i + PUZZLES.length) % PUZZLES.length;
      closeDlg();
      reset(PUZZLES[k].fen);
      S.puzzle = { i: k, id: PUZZLES[k].id, step: 0, solved: false };
      flipped = false;
      S.cursor = 0x14;
      ctx.onScore(0);
      paint();
      say(`Puzzle ${k + 1} of ${PUZZLES.length}. White to move and mate in two.`);
      refocus();
    }
    function leavePuzzles() {
      S.puzzle = null;
      newGame();
      refocus();
    }
    /* after each move in a puzzle: check it, answer it, or take it back */
    function puzzleStep(by) {
      const P = S.puzzle;
      if (by !== 'me') { P.step = 2; paint(); return; }
      if (P.step === 0) {
        if (stillMates(S.pos, 1)) {
          P.step = 1;
          paint();
          /* Black's toughest defence: the reply that leaves White the fewest mates */
          S.wait = setTimeout(() => {
            S.wait = 0;
            if (dead || S.puzzle !== P) return;
            let best = 0, fewest = Infinity;
            for (const r of S.pos.legalMoves()) {
              S.pos.make(r);
              let n = 0;
              for (const m of S.pos.legalMoves()) { S.pos.make(m); if (isMate(S.pos)) n++; S.pos.unmake(); }
              S.pos.unmake();
              if (n < fewest) { fewest = n; best = r; }
            }
            if (best) apply(best, 'cpu');
          }, reduced ? 150 : 500);
          return;
        }
        missed('That lets Black escape. Try another first move.');
        return;
      }
      if (isMate(S.pos)) {
        P.solved = true;
        S.over = { over: true, winner: WHITE, reason: 'checkmate' };
        const solved = new Set(readPrefs().solved);
        solved.add(P.id);
        writePrefs({ solved: [...solved] });
        snd.blip(880, 0.14, 'triangle', 0.8);
        const t = `Solved — checkmate! ${solved.size} of ${PUZZLES.length} solved.`;
        say(t);
        ctx.announce?.(t);
        paint();
        return;
      }
      missed('Not mate yet. Try another move.');
    }
    function missed(t) {
      S.over = null;
      say(t);
      ctx.announce?.(t);
      snd.blip(160, 0.12, 'sawtooth', 0.4);
      S.wait = setTimeout(() => {
        S.wait = 0;
        if (dead || !S.puzzle) return;
        takeBack();
        const lastMove = S.hist[S.hist.length - 1];
        S.last = lastMove ? { from: mFrom(lastMove.m), to: mTo(lastMove.m) } : null;
        paint();
      }, reduced ? 300 : 900);
      paint();
    }

    /* ------------------------------ text ------------------------------ */
    function spoken(san) {
      return san.replace(/^O-O-O/, 'castles queenside').replace(/^O-O/, 'castles kingside')
        .replace(/^N/, 'knight ').replace(/^B/, 'bishop ').replace(/^R/, 'rook ').replace(/^Q/, 'queen ').replace(/^K/, 'king ')
        .replace('x', ' takes ').replace('=', ' promotes to ').replace(/[+#]$/, '');
    }
    function overText() {
      const o = S.over;
      if (!o) return '';
      const how = REASON[o.reason] || o.reason;
      if (o.winner === 0) return `Draw by ${how}.`;
      if (mode === '2p') return `${colorName(o.winner)} wins by ${how}.`;
      const other = mode === 'cpu' ? 'the computer' : peerName;
      if (o.winner === me) {
        if (o.reason === 'resign') return `${mode === 'cpu' ? 'The computer' : peerName} resigned — you win.`;
        if (o.reason === 'time') return `Time ran out for ${other} — you win.`;
        return S.loaded && !S.myMoves ? `${colorName(o.winner)} won by ${how}.` : 'Checkmate — you win!';
      }
      if (o.reason === 'resign') return 'You resigned.';
      if (o.reason === 'time') return `Your time ran out — ${other} wins.`;
      return S.loaded && !S.myMoves ? `${colorName(o.winner)} won by ${how}.` : `Checkmate — ${other} wins.`;
    }
    function say(t) { sr.textContent = t; }

    /* ------------------------------ panel ------------------------------ */
    function material(pos) {
      let d = 0;
      for (let sq = 0; sq < 128; sq++) { if (sq & 0x88) { sq += 7; continue; } const p = pos.b[sq]; if (p) d += Math.sign(p) * VALUE[Math.abs(p)]; }
      return d;      /* + = White ahead */
    }
    function paint() {
      if (dead) return;
      const pos = S.pos;
      const check = pos.inCheck();
      const P = S.puzzle;
      let text;
      if (P) {
        text = P.solved ? `Puzzle ${P.i + 1} solved — checkmate!` : P.step === 1 ? 'Black is answering…' : P.step === 2 ? 'Good. Now mate.' : `Puzzle ${P.i + 1} of ${PUZZLES.length}: White mates in two`;
        if (S.wait && !P.solved && P.step !== 1) text = sr.textContent || text;
      } else if (S.over) text = overText();
      else if (mode === 'cpu') text = pos.turn === me ? (check ? 'Check! Your move' : 'Your move') : 'The computer is thinking…';
      else if (mode === '2p') text = `${colorName(pos.turn)} to move${check ? ' — check!' : ''}`;
      else text = pos.turn === me ? (check ? 'Check! Your move' : 'Your move') : `${peerName}’s move${check ? ' — check' : ''}`;
      if (S.promo) text = 'Pick what the pawn becomes';
      if (S.hintBusy) text = 'Finding a hint…';
      statusEl.textContent = text;
      statusEl.classList.toggle('is-alert', !S.over && check && !P);
      statusEl.classList.toggle('is-done', !!S.over || !!P?.solved);

      const mat = material(pos);
      const plus = c => { const v = mat * c; return v > 0 ? ` · +${v}` : ''; };
      const topColor = mode === '2p' || P ? BLACK : them(), botColor = mode === '2p' || P ? WHITE : me;
      const sw = c => (c === WHITE ? '#f4f1ea' : '#2a2430');
      const topName = P ? 'Black' : mode === '2p' ? 'Black' : mode === 'cpu' ? 'Computer' : peerName;
      const topNote = mode === 'cpu' && !P ? `${LEVELS[S.level].name} · ${colorName(topColor)}${plus(topColor)}` : `${colorName(topColor)}${plus(topColor)}`;
      topStrip.set({ name: topName, note: topNote, color: sw(topColor), turn: !S.over && pos.turn === topColor, thinking: S.thinking });
      botStrip.set({ name: P ? 'You' : mode === '2p' ? 'White' : 'You', note: `${colorName(botColor)}${plus(botColor)}`, color: sw(botColor), turn: !S.over && pos.turn === botColor, thinking: false });
      paintClocks();

      const last = S.hist.length - 1;
      const mv = i => (S.hist[i] ? h('button.arx-ch__mv', {
        type: 'button', dataset: { ply: String(i + 1) }, class: [i === last && S.view === null ? 'is-last' : '', S.view === i + 1 ? 'is-view' : ''].filter(Boolean).join(' ') || null,
        'aria-label': `Move ${Math.floor(i / 2) + 1}, ${colorName(S.hist[i].color)}: ${spoken(S.hist[i].san)}`, onclick: () => viewAt(i + 1),
      }, S.hist[i].san) : h('span', { text: '' }));
      const rows = [];
      /* a game set up with Black to move starts its list "1… e5" */
      const blackFirst = S.hist[0]?.color === BLACK;
      const n0 = Math.max(1, parseInt(S.startFen.split(/\s+/)[5], 10) || 1);
      if (blackFirst) rows.push(h('li', h('span', { text: `${n0}.` }), h('span', { text: '…' }), mv(0)));
      for (let i = blackFirst ? 1 : 0, r = blackFirst ? 1 : 0; i < S.hist.length; i += 2, r++) {
        rows.push(h('li', h('span', { text: `${n0 + r}.` }), mv(i), mv(i + 1)));
      }
      movesEl.replaceChildren(...rows);
      if (S.view === null) movesEl.scrollTop = movesEl.scrollHeight;
      else movesEl.querySelector('.is-view')?.scrollIntoView?.({ block: 'nearest' });

      reviewBar.hidden = S.view === null;
      if (S.view !== null) revPos.textContent = S.view === 0 ? 'Start' : `Move ${S.view} of ${S.hist.length}`;
      const inPz = !!P;
      for (const x of [levelSeg?.el, sideSeg?.el, clockSeg?.el, recLine?.el]) if (x) x.hidden = inPz;
      playRow.hidden = inPz;
      pzRow.hidden = !inPz;
      if (undoBtn) undoBtn.disabled = !!S.over || !S.hist.some((x, i) => i >= (S.loaded?.plies || 0) && (mode === '2p' || x.by === 'me'));
      if (resignBtn) { resignBtn.disabled = !!S.over; if (S.over) resignBtn.reset(); }
      if (hintBtn) { hintBtn.disabled = !canAct() || S.hintBusy; hintBtn.setLabel(S.hintBusy ? 'Thinking…' : 'Hint'); }
      levelSeg?.set(S.level);
      paintRecord();
      const lastSan = S.view === null ? S.hist[last]?.san : S.hist[S.view - 1]?.san;
      sf.cv.setAttribute('aria-label', `Chess board. ${S.view !== null ? `Reviewing ${S.view ? `move ${S.view}` : 'the start'}. ` : ''}${text}. ${lastSan ? `Last move ${lastSan}.` : ''}${S.hint && S.view === null ? ` Hint: ${S.hint.san}.` : ''}`);
      const liveScore = mode === 'cpu' ? S.myMoves : mode === '2p' ? Math.ceil(S.hist.length / 2) : S.hist.filter(x => x.by === 'me').length;
      ctx.onScore(liveScore);
      if (NET) NET.peerScore?.(S.hist.filter(x => x.by === 'peer').length);
      draw();
    }

    /* ------------------------------ drawing ------------------------------ */
    function layout() {
      const size = Math.max(64, Math.min(sf.w, sf.h) - 4);
      const sq = Math.floor(size / 8);
      return { sq, x: Math.round((sf.w - sq * 8) / 2), y: Math.round((sf.h - sq * 8) / 2) };
    }
    const cellOf = sq => ({ col: flipped ? 7 - (sq & 7) : sq & 7, row: flipped ? sq >> 4 : 7 - (sq >> 4) });
    function squareAt(px, py) {
      const L = S.geo;
      const col = Math.floor((px - L.x) / L.sq), row = Math.floor((py - L.y) / L.sq);
      if (col < 0 || col > 7 || row < 0 || row > 7) return -1;
      const file = flipped ? 7 - col : col, rank = flipped ? row : 7 - row;
      return rank * 16 + file;
    }

    function draw() {
      if (dead) return;
      const g = sf.g;
      sf.begin();
      const T = THEMES[S.look.theme] || THEMES.arcade;
      const L = S.geo = layout();
      g.fillStyle = T.bg;
      g.fillRect(0, 0, sf.w, sf.h);
      const glow = g.createRadialGradient(sf.w / 2, sf.h / 2, 0, sf.w / 2, sf.h / 2, Math.max(sf.w, sf.h) * 0.6);
      glow.addColorStop(0, T.glow);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = glow;
      g.fillRect(0, 0, sf.w, sf.h);
      g.save();
      g.shadowBlur = 28;
      g.shadowColor = T.halo;
      g.fillStyle = T.frame;
      rr(g, L.x - 6, L.y - 6, L.sq * 8 + 12, L.sq * 8 + 12, 10);
      g.fill();
      g.restore();
      const reviewing = S.view !== null;
      const pos = viewPos(), now = performance.now();
      const lastMove = reviewing ? (S.view ? { from: mFrom(S.hist[S.view - 1].m), to: mTo(S.hist[S.view - 1].m) } : null) : S.last;
      const targets = reviewing ? [] : S.targets;
      const legalTo = new Set(targets.map(mTo));
      const hoverSq = S.drag?.moved ? squareAt(S.drag.x, S.drag.y) : S.hover;
      for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
        const sq = r * 16 + f, { col, row } = cellOf(sq);
        const x = L.x + col * L.sq, y = L.y + row * L.sq;
        g.fillStyle = (r + f) % 2 ? T.light : T.dark;
        g.fillRect(x, y, L.sq, L.sq);
        if (S.look.last && lastMove && (sq === lastMove.from || sq === lastMove.to)) { g.fillStyle = T.last; g.fillRect(x, y, L.sq, L.sq); }
        if (!reviewing && sq === S.sel) { g.fillStyle = 'rgba(80,220,255,.45)'; g.fillRect(x, y, L.sq, L.sq); }
        if (legalTo.has(sq) && sq === hoverSq) { g.fillStyle = 'rgba(80,220,255,.32)'; g.fillRect(x, y, L.sq, L.sq); }
      }
      /* the king in check */
      if (pos.inCheck()) {
        const k = pos.kingSq(pos.turn), { col, row } = cellOf(k);
        const cx = L.x + (col + 0.5) * L.sq, cy = L.y + (row + 0.5) * L.sq;
        const rg = g.createRadialGradient(cx, cy, 0, cx, cy, L.sq * 0.62);
        rg.addColorStop(0, 'rgba(255,40,60,.95)');
        rg.addColorStop(1, 'rgba(255,40,60,0)');
        g.fillStyle = rg;
        g.fillRect(cx - L.sq / 2, cy - L.sq / 2, L.sq, L.sq);
      }
      /* coordinates, inside the edge squares */
      if (S.look.coords) {
        const fs = Math.max(8, Math.round(L.sq * 0.17));
        g.font = `700 ${fs}px Inter,ui-sans-serif,system-ui,sans-serif`;
        for (let i = 0; i < 8; i++) {
          /* each label in the other square colour, so it reads on its square */
          const fileSq = flipped ? 7 - i : i;
          g.textAlign = 'right'; g.textBaseline = 'bottom';
          const bottomRank = flipped ? 7 : 0;
          g.fillStyle = (bottomRank + fileSq) % 2 ? T.dark : T.light;
          g.fillText('abcdefgh'[fileSq], L.x + (i + 1) * L.sq - 3, L.y + 8 * L.sq - 2);
          const rank = flipped ? i : 7 - i;
          const leftFile = flipped ? 7 : 0;
          g.fillStyle = (rank + leftFile) % 2 ? T.dark : T.light;
          g.textAlign = 'left'; g.textBaseline = 'top';
          g.fillText(String(rank + 1), L.x + 3, L.y + i * L.sq + 2);
        }
      }
      /* where the picked piece can go */
      if (S.look.dots) for (const sq of legalTo) {
        const { col, row } = cellOf(sq);
        const cx = L.x + (col + 0.5) * L.sq, cy = L.y + (row + 0.5) * L.sq;
        g.fillStyle = 'rgba(10,30,40,.38)';
        g.strokeStyle = 'rgba(10,30,40,.42)';
        if (pos.piece(sq) || targets.some(m => mTo(m) === sq && (mFlags(m) & F_CAPTURE))) {
          g.lineWidth = L.sq * 0.08;
          g.beginPath(); g.arc(cx, cy, L.sq * 0.44, 0, Math.PI * 2); g.stroke();
        } else {
          g.beginPath(); g.arc(cx, cy, L.sq * 0.15, 0, Math.PI * 2); g.fill();
        }
      }
      /* pieces */
      const moving = new Map();
      S.anims = reviewing ? [] : S.anims.filter(a => now - a.t0 < a.dur);
      for (const a of S.anims) moving.set(a.to, a);
      for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
        const sq = r * 16 + f, p = pos.b[sq];
        if (!p || moving.has(sq)) continue;
        const { col, row } = cellOf(sq);
        const dragging = S.drag?.moved && S.drag.from === sq;
        g.globalAlpha = dragging ? 0.3 : 1;
        drawPiece(g, Math.abs(p), p > 0, L.x + col * L.sq, L.y + row * L.sq, L.sq);
        g.globalAlpha = 1;
      }
      for (const a of S.anims) {
        const k = 1 - (1 - Math.min(1, (now - a.t0) / a.dur)) ** 3;
        const A = cellOf(a.from), B = cellOf(a.to);
        drawPiece(g, Math.abs(a.piece), a.piece > 0, L.x + (A.col + (B.col - A.col) * k) * L.sq, L.y + (A.row + (B.row - A.row) * k) * L.sq, L.sq);
      }
      /* the hint: an arrow from the piece to its square */
      if (S.hint && !reviewing) {
        const A = cellOf(S.hint.from), B = cellOf(S.hint.to);
        const ax = L.x + (A.col + 0.5) * L.sq, ay = L.y + (A.row + 0.5) * L.sq, bx = L.x + (B.col + 0.5) * L.sq, by = L.y + (B.row + 0.5) * L.sq;
        const ang = Math.atan2(by - ay, bx - ax), head = L.sq * 0.34;
        g.save();
        g.strokeStyle = 'rgba(40,220,120,.85)';
        g.fillStyle = 'rgba(40,220,120,.85)';
        g.lineWidth = Math.max(3, L.sq * 0.13);
        g.lineCap = 'round';
        g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx - Math.cos(ang) * head * 0.8, by - Math.sin(ang) * head * 0.8); g.stroke();
        g.beginPath();
        g.moveTo(bx, by);
        g.lineTo(bx - Math.cos(ang - 0.45) * head, by - Math.sin(ang - 0.45) * head);
        g.lineTo(bx - Math.cos(ang + 0.45) * head, by - Math.sin(ang + 0.45) * head);
        g.closePath(); g.fill();
        g.restore();
      }
      if (S.drag?.moved) {
        const p = pos.b[S.drag.from];
        if (p) drawPiece(g, Math.abs(p), p > 0, S.drag.x - L.sq * 0.55, S.drag.y - L.sq * 0.6, L.sq * 1.1);
      }
      /* the keyboard cursor */
      if (S.kb && !S.over && !reviewing) {
        const { col, row } = cellOf(S.cursor);
        g.strokeStyle = S.look.theme === 'paper' ? '#1d2a3a' : '#ffffff';
        g.lineWidth = 3;
        g.strokeRect(L.x + col * L.sq + 2.5, L.y + row * L.sq + 2.5, L.sq - 5, L.sq - 5);
        g.strokeStyle = 'rgba(0,0,0,.6)';
        g.lineWidth = 1;
        g.strokeRect(L.x + col * L.sq + 5, L.y + row * L.sq + 5, L.sq - 10, L.sq - 10);
      }
    }

    /* ------------------------------ input ------------------------------ */
    const at = e => { const r = sf.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const onDown = e => {
      if (e.button > 0 || dead) return;
      snd.wake();
      S.kb = false;
      if (S.view !== null) { live(); return; }               /* a click on the board while looking back returns to the game */
      const { x, y } = at(e);
      const sq = squareAt(x, y);
      if (sq < 0) { if (S.sel >= 0) clearSel(); return; }
      if (!canAct()) return;
      if (S.sel >= 0 && sq !== S.sel && S.targets.some(m => mTo(m) === sq)) { tryMove(S.sel, sq); return; }
      if (isOwn(sq)) {
        const was = S.sel === sq;
        select(sq);
        S.drag = { from: sq, id: e.pointerId, x0: x, y0: y, x, y, moved: false, was };
        try { sf.cv.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
        paint();
        return;
      }
      if (S.sel >= 0) clearSel();
    };
    const onMove = e => {
      const { x, y } = at(e);
      const d = S.drag;
      if (d && d.id === e.pointerId) {
        d.x = x; d.y = y;
        if (!d.moved && Math.hypot(x - d.x0, y - d.y0) > 5) d.moved = true;
        if (d.moved) draw();
        return;
      }
      const sq = squareAt(x, y);
      if (sq !== S.hover) {
        S.hover = sq;
        sf.cv.style.cursor = sq >= 0 && canAct() && (isOwn(sq) || S.targets.some(m => mTo(m) === sq)) ? 'pointer' : 'default';
        if (S.sel >= 0) draw();
      }
    };
    const onUp = e => {
      const d = S.drag;
      if (!d || d.id !== e.pointerId) return;
      S.drag = null;
      const { x, y } = at(e);
      if (d.moved) {
        const to = squareAt(x, y);
        if (to >= 0 && to !== d.from && S.targets.some(m => mTo(m) === to)) { tryMove(d.from, to, { dropped: true }); return; }
        draw();
        return;
      }
      if (d.was) clearSel();
    };
    const onCancel = () => { if (S.drag) { S.drag = null; draw(); } };
    const onLeave = () => { if (S.hover !== -1) { S.hover = -1; if (S.sel >= 0) draw(); } };

    function activate(sq) {
      if (!canAct()) return;
      if (S.sel >= 0) {
        if (sq === S.sel) { clearSel(); return; }
        if (S.targets.some(m => mTo(m) === sq)) { tryMove(S.sel, sq); return; }
      }
      if (isOwn(sq)) { select(sq); paint(); } else if (S.sel >= 0) clearSel();
    }
    const onKey = e => {
      if (!ownsKey(el, e) || dead) return;
      if (S.promo) {
        const t = { q: QUEEN, r: ROOK, b: BISHOP, n: KNIGHT }[e.key.toLowerCase()];
        if (t) { e.preventDefault(); choosePromo(t); } else if (e.key === 'Escape') { e.preventDefault(); closePromo(); paint(); refocus(); }
        return;
      }
      if (dlg || opts.isOpen()) return;
      const k = e.key;
      /* looking back through the game: the arrows step, Esc returns */
      if (S.view !== null) {
        if (k === 'ArrowLeft') { e.preventDefault(); step(-1); return; }
        if (k === 'ArrowRight') { e.preventDefault(); step(1); return; }
        if (k === 'Home') { e.preventDefault(); viewAt(0); return; }
        if (k === 'End' || k === 'Escape') { e.preventDefault(); live(); return; }
        if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'Enter' || k === ' ') { e.preventDefault(); return; }
      }
      if (S.ended) return;
      if (ARROWS[k]) {
        e.preventDefault();
        snd.wake();
        let [df, dr] = ARROWS[k];
        if (flipped) { df = -df; dr = -dr; }
        const f = Math.max(0, Math.min(7, (S.cursor & 7) + df)), r = Math.max(0, Math.min(7, (S.cursor >> 4) + dr));
        S.cursor = r * 16 + f;
        S.kb = true;
        draw();
        return;
      }
      if (k === 'Enter' || k === ' ') { e.preventDefault(); snd.wake(); S.kb = true; activate(S.cursor); draw(); return; }
      if (k === 'Escape' && S.sel >= 0) { e.preventDefault(); clearSel(); return; }
      if ((k === 'u' || k === 'U' || k === 'z' || k === 'Z' || k === 'Backspace') && mode !== 'online') { e.preventDefault(); undo(); }
    };
    window.addEventListener('keydown', onKey);
    sf.cv.addEventListener('pointerdown', onDown);
    sf.cv.addEventListener('pointermove', onMove);
    sf.cv.addEventListener('pointerup', onUp);
    sf.cv.addEventListener('pointercancel', onCancel);
    sf.cv.addEventListener('pointerleave', onLeave);
    sf.cv.addEventListener('contextmenu', e => e.preventDefault());

    newGame();

    const pause = () => { if (S.paused) return; if (S.run) S.left[ci(S.run)] -= spent(); S.paused = true; paintClocks(); };
    const resume = () => { if (!S.paused) return; S.paused = false; S.runAt = performance.now(); paintClocks(); };
    return {
      stop() {
        dead = true;
        offEsc?.();
        opts.close();
        clearTimeout(S.endT);
        clearTimeout(S.wait);
        clearInterval(ticker);
        brain?.close();
        link?.stop();
        loop.stop();
        window.removeEventListener('keydown', onKey);
        sf.cv.removeEventListener('pointerdown', onDown);
        sf.cv.removeEventListener('pointermove', onMove);
        sf.cv.removeEventListener('pointerup', onUp);
        sf.cv.removeEventListener('pointercancel', onCancel);
        sf.cv.removeEventListener('pointerleave', onLeave);
        resignBtn?.reset();
        snd.close();
        sf.destroy();
        root.remove();
      },
      /* the Arcade's pause stops the clocks; without a clock there is nothing to pause */
      get pause() { return clockOn() ? pause : undefined; },
      get resume() { return clockOn() || S.paused ? resume : undefined; },
      /* test hook (the shell's el.arcadeHook): inert unless a test calls it.
         { clock: { w?, b? } } sets the time left on a clock, in ms */
      hook: cmd => {
        if (!cmd || typeof cmd !== 'object' || !cmd.clock) return;
        for (const [k, ms] of Object.entries(cmd.clock)) {
          const c = k === 'w' ? WHITE : BLACK;
          S.left[ci(c)] = Number(ms) + (S.run === c ? spent() : 0);
        }
        paintClocks();
      },
      /* what a watcher may see (./spectate.js): the position, whose move, the status line */
      spectate: () => ({
        k: 'board', st: 'chess', w: 8, h: 8,
        cells: S.pos.fen().split(' ')[0].split('/').map(r => r.replace(/[1-8]/g, d => '.'.repeat(Number(d)))).join(''),
        hl: [], txt: statusEl.textContent, over: !!S.over, x: null, turn: S.over ? 0 : S.pos.turn === WHITE ? 1 : -1,
        pl: [{ n: mode === '2p' ? 'White' : me === WHITE ? 'You' : (mode === 'cpu' ? 'Computer' : peerName), m: 'White' },
          { n: mode === '2p' ? 'Black' : me === BLACK ? 'You' : (mode === 'cpu' ? 'Computer' : peerName), m: 'Black' }],
      }),
      /* a read-only snapshot for automated play-tests */
      peek: () => ({
        mode, fen: S.pos.fen(), turn: S.pos.turn === WHITE ? 'w' : 'b', me: mode === '2p' ? null : me === WHITE ? 'w' : 'b',
        flipped, level: S.level, lowest: S.lowest, thinking: S.thinking, worker: !!brain?.worker,
        over: S.over ? { winner: S.over.winner === WHITE ? 'w' : S.over.winner === BLACK ? 'b' : null, reason: S.over.reason } : null,
        ended: S.ended, san: S.hist.map(x => x.san), uci: S.hist.map(x => x.uci), myMoves: S.myMoves,
        sel: S.sel >= 0 ? sqName(S.sel) : null, targets: S.targets.map(m => sqName(mTo(m))), cursor: sqName(S.cursor),
        promo: !!S.promo, rejected: S.rejected, check: S.pos.inCheck(), animating: S.anims.length > 0,
        geo: { ...S.geo }, status: statusEl.textContent,
        look: { ...S.look }, hint: S.hint ? { from: sqName(S.hint.from), to: sqName(S.hint.to), san: S.hint.san } : null, hints: S.hints, hintBusy: S.hintBusy,
        view: S.view, viewFen: S.view === null ? null : viewPos().fen(), startFen: S.startFen,
        clock: { min: S.clockMin, on: clockOn(), w: Math.round(leftOf(WHITE)), b: Math.round(leftOf(BLACK)), run: S.run === WHITE ? 'w' : S.run === BLACK ? 'b' : null, paused: S.paused },
        loaded: S.loaded ? { plies: S.loaded.plies, tags: { ...S.loaded.tags } } : null,
        puzzle: S.puzzle ? { ...S.puzzle, n: PUZZLES.length } : null, dialog: dlg ? dlg.getAttribute('aria-label') : opts.isOpen() ? 'Board options' : null,
        pgn: pgnText(),
      }),
    };
  },
};

/* ------------------------------ the pieces ------------------------------ */
/* drawn as shapes on a 100×100 square (no font needed), scaled to s */
function drawPiece(g, t, white, x, y, s) {
  g.save();
  g.translate(x, y);
  g.scale(s / 100, s / 100);
  const grad = g.createLinearGradient(0, 10, 0, 90);
  const fill = white ? W_FILL : B_FILL;
  grad.addColorStop(0, fill[0]);
  grad.addColorStop(1, fill[1]);
  g.fillStyle = grad;
  g.strokeStyle = white ? W_INK : B_INK;
  g.lineWidth = 3.4;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.shadowColor = 'rgba(0,0,0,.35)';
  g.shadowBlur = 4;
  g.shadowOffsetY = 2;
  const shape = fn => { g.beginPath(); fn(); g.fill(); g.shadowColor = 'transparent'; g.stroke(); };
  const rect = (a, b, w, hh, r) => shape(() => { rr(g, a, b, w, hh, r); });
  const detail = (fn, w = 2.6) => { g.beginPath(); fn(); g.strokeStyle = white ? W_INK : B_DETAIL; g.lineWidth = w; g.stroke(); g.strokeStyle = white ? W_INK : B_INK; g.lineWidth = 3.4; };
  switch (t) {
    case PAWN:
      shape(() => { g.moveTo(41, 50); g.bezierCurveTo(41, 62, 34, 70, 31, 79); g.lineTo(69, 79); g.bezierCurveTo(66, 70, 59, 62, 59, 50); g.closePath(); });
      rect(37, 43, 26, 8, 3.5);
      shape(() => { g.arc(50, 31, 12, 0, Math.PI * 2); });
      rect(25, 78, 50, 10, 4);
      break;
    case ROOK:
      shape(() => { g.moveTo(34, 36); g.lineTo(66, 36); g.lineTo(68, 72); g.lineTo(32, 72); g.closePath(); });
      shape(() => {
        g.moveTo(27, 17); g.lineTo(37, 17); g.lineTo(37, 25); g.lineTo(45, 25); g.lineTo(45, 17); g.lineTo(55, 17); g.lineTo(55, 25);
        g.lineTo(63, 25); g.lineTo(63, 17); g.lineTo(73, 17); g.lineTo(73, 37); g.lineTo(27, 37); g.closePath();
      });
      rect(28, 70, 44, 9, 2.5);
      rect(23, 78, 54, 10, 4);
      break;
    case KNIGHT:
      shape(() => {
        g.moveTo(71, 79); g.bezierCurveTo(73, 56, 71, 34, 55, 22); g.lineTo(53, 11); g.lineTo(45, 20);
        g.bezierCurveTo(36, 22, 28, 32, 22, 46); g.lineTo(19, 54); g.bezierCurveTo(21, 60, 28, 61, 32, 58);
        g.lineTo(41, 52); g.bezierCurveTo(45, 51, 48, 49, 51, 46); g.bezierCurveTo(49, 57, 38, 65, 32, 79); g.closePath();
      });
      rect(25, 78, 52, 10, 4);
      g.fillStyle = white ? W_INK : B_DETAIL;
      g.beginPath(); g.arc(40, 34, 2.8, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(25, 51, 1.7, 0, Math.PI * 2); g.fill();
      detail(() => { g.moveTo(56, 25); g.bezierCurveTo(64, 36, 67, 50, 66, 66); });
      break;
    case BISHOP:
      shape(() => { g.moveTo(41, 63); g.bezierCurveTo(41, 70, 36, 74, 33, 79); g.lineTo(67, 79); g.bezierCurveTo(64, 74, 59, 70, 59, 63); g.closePath(); });
      shape(() => { g.moveTo(50, 22); g.bezierCurveTo(65, 32, 67, 47, 60, 57); g.lineTo(40, 57); g.bezierCurveTo(33, 47, 35, 32, 50, 22); g.closePath(); });
      rect(36, 56, 28, 8, 3.5);
      shape(() => { g.arc(50, 16, 5.5, 0, Math.PI * 2); });
      rect(25, 78, 50, 10, 4);
      detail(() => { g.moveTo(56, 33); g.lineTo(46, 45); }, 3);
      break;
    case QUEEN: {
      shape(() => { g.moveTo(38, 65); g.bezierCurveTo(38, 71, 34, 75, 31, 79); g.lineTo(69, 79); g.bezierCurveTo(66, 75, 62, 71, 62, 65); g.closePath(); });
      shape(() => {
        g.moveTo(33, 60); g.lineTo(23, 30); g.lineTo(34, 45); g.lineTo(37, 23); g.lineTo(45, 42); g.lineTo(50, 19);
        g.lineTo(55, 42); g.lineTo(63, 23); g.lineTo(66, 45); g.lineTo(77, 30); g.lineTo(67, 60); g.closePath();
      });
      rect(33, 58, 34, 8, 3.5);
      for (const [cx, cy] of [[23, 28], [37, 21], [50, 17], [63, 21], [77, 28]]) shape(() => { g.arc(cx, cy, 4.2, 0, Math.PI * 2); });
      rect(24, 78, 52, 10, 4);
      break;
    }
    case KING:
      shape(() => { g.moveTo(38, 64); g.bezierCurveTo(38, 71, 34, 75, 31, 79); g.lineTo(69, 79); g.bezierCurveTo(66, 75, 62, 71, 62, 64); g.closePath(); });
      shape(() => {
        g.moveTo(32, 59); g.bezierCurveTo(20, 47, 25, 30, 39, 32); g.bezierCurveTo(44, 33, 48, 37, 50, 42);
        g.bezierCurveTo(52, 37, 56, 33, 61, 32); g.bezierCurveTo(75, 30, 80, 47, 68, 59); g.closePath();
      });
      rect(32, 57, 36, 8, 3.5);
      rect(46.5, 8, 7, 24, 1.8);
      rect(40, 14, 20, 7, 1.8);
      rect(24, 78, 52, 10, 4);
      break;
    default: break;
  }
  g.restore();
}

export { drawPiece };
