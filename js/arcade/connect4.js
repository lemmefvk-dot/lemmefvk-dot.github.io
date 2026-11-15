/* ============================================================
   arcade/connect4.js — Connect Four for Static Arcade.

   Drop a disc into a column and it falls to the lowest free hole.
   Four in a row — across, down or diagonal — wins, and the winning
   line lights up. The board is 7 × 6, or 6 × 5, 8 × 7 or 9 × 7
   (Size), and Rules switches to Pop Out: on your turn you may pop one
   of your own discs out of the bottom row instead (rules, edge cases
   and computer in ./c4-rules.js; the Board card says them in full).

   · 1P: against the computer (Easy, Medium, Hard — minimax with
     alpha-beta in ./c4-rules.js, run in a Web Worker so the page
     keeps drawing), you or the computer first. Level, first, size,
     rules and the board's look are remembered in
     portal.arcadeConnect4. Undo takes back your last move and its
     reply. Hint asks Hard for your move and marks it; a game with a
     hint never sets a best. Your won / lost / drawn record against
     each level, size and rule set is under the Level row
     (./records.js; only games played to the end, resigning counts as
     lost, and a game counts at the easiest level it was played at).
   · 2P: Yellow and Red take turns on one screen (Hint works too).
   · Online: a friend on another device through the Arcade's room,
     always classic 7 × 6. The host goes first in odd rounds, the
     guest in even ones. On your screen your discs are always yellow
     and your strip is at the bottom. Every arriving move is checked
     (whose turn, a real column with room) before it reaches the board.

   Mouse or touch: point at a column and click; in Pop Out, click the
   arrow under one of your bottom discs to pop it. Keyboard: ← → pick a
   column, Enter / Space / ↓ drop, 1–9 drop straight into a column,
   P / ↑ pop, H hint, U / Z / Backspace undo. Score in 1P: a win on the
   classic 7 × 6 board scores the number of discs it took (fewer is
   better); other sizes and Pop Out don't score.
   ============================================================ */
import { h } from '../core/dom.js';
import { store } from '../core/store.js';
import { SIZES, newGame as freshGame, canPlay, canPop, isLegal, move as applyMove, undo as unplay, outcome, legalMoves, LEVELS } from './c4-rules.js';
import { thinker } from './thinker.js';
import * as records from './records.js';
import { KIT_CSS, surface, ownsKey, sounder, looper, rr, playerStrip, segment, button, confirmButton, duelLink, boardOptions, lookOf, recordLine } from './boardkit.js';
import { PALETTE_CB } from './index.js';

const PREF = 'portal.arcadeConnect4';
const YELLOW = '#ffd23f', RED = '#ff4d6d';
/* the Arcade's colour-blind set (ctx.palette 'cb'): orange and blue, and a
   mark on every disc — a dot on the first side's, a cross on the other's —
   so the two sides differ even without colour */
const CB_FIRST = PALETTE_CB[0], CB_OTHER = PALETTE_CB[4];
const MIN_THINK_MS = 380;
const SIZE_IDS = SIZES.map(([c, r]) => `${c}x${r}`);
/* the board's four looks (boardkit's BOARD_THEMES); 'arcade' is the original */
const LOOKS = {
  arcade: { bg: '#05060d', glow: 'hsla(220,90%,45%,.2)', board: ['#2a5cff', '#1532a8'], halo: 'hsla(220,100%,55%,.55)', edge: 'rgba(160,190,255,.35)', ink: 'rgba(200,215,255,.8)', mark: '#ffffff' },
  wood: { bg: '#120b06', glow: 'hsla(30,80%,40%,.18)', board: ['#b07a3f', '#74461d'], halo: 'rgba(0,0,0,.55)', edge: 'rgba(255,220,170,.45)', ink: 'rgba(255,226,186,.85)', mark: '#fff6e0' },
  paper: { bg: '#efe9dc', glow: null, board: ['#4f6d94', '#3a5476'], halo: 'rgba(40,30,10,.25)', edge: 'rgba(25,25,35,.7)', ink: '#33333d', mark: '#15151c' },
  contrast: { bg: '#000000', glow: null, board: ['#141414', '#141414'], halo: null, edge: '#ffffff', ink: '#ffffff', mark: '#ffffff', rings: '#ffffff' },
};
const SAMPLES = { arcade: ['#2a5cff', '#05060d'], wood: ['#b07a3f', '#120b06'], paper: ['#4f6d94', '#efe9dc'], contrast: ['#ffffff', '#000000'] };

const readPrefs = () => {
  let p = null;
  try { p = store.get(PREF, null); } catch (err) { p = null; }
  return {
    level: [1, 2, 3].includes(p?.level) ? p.level : 2, first: p?.first === 'cpu' ? 'cpu' : 'me',
    size: SIZE_IDS.includes(p?.size) ? p.size : '7x6', pop: p?.pop === true, ...lookOf(p),
  };
};
const writePrefs = patch => { try { store.set(PREF, { ...readPrefs(), ...patch }); } catch (err) { /* a convenience */ } };

export default {
  mount(el, ctx) {
    const NET = ctx.online && typeof ctx.online.send === 'function' ? ctx.online : null;
    const mode = NET ? 'online' : ctx.players === 2 ? '2p' : 'cpu';
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    /* the computer, and the hint (on one screen too): never online */
    const brain = mode !== 'online' ? thinker() : null;
    const prefs = readPrefs();
    const host = NET?.role === 'host';
    const round = Number.isInteger(NET?.round) ? NET.round : 1;
    const peerName = String(NET?.peer?.name || 'Friend');
    /* 1 = whoever moves first; me is the value of my discs (2P: none) */
    let me = mode === 'online' ? ((round % 2 === 1) === host ? 1 : -1) : mode === 'cpu' ? (prefs.first === 'cpu' ? -1 : 1) : 0;
    let dead = false;
    /* online is always the classic 7 × 6 board */
    const [cols0, rows0] = mode === 'online' ? [7, 6] : prefs.size.split('x').map(Number);

    const S = {
      cols: cols0, rows: rows0, pop: mode !== 'online' && prefs.pop,
      g: null, by: [], over: null, line: null, drops: [], pops: [], hover: -1, hoverPop: false, cursor: 3, kb: false,
      thinking: false, thinkId: 0, level: prefs.level, lowest: prefs.level, first: prefs.first, rejected: 0, myMoves: 0,
      ended: false, endT: 0, geo: { x: 0, y: 0, cell: 0 }, shake: 0,
      look: lookOf(prefs), hint: null, hints: 0, hintId: 0, hinting: false,
    };
    S.g = freshGame(1, { cols: S.cols, rows: S.rows, pop: S.pop });
    /* ctx.palette is a getter: switching it in the Arcade's options shows on the next frame */
    const cb = () => ctx.palette === 'cb';
    const yellowSide = v => (mode === '2p' ? v === 1 : v === me);
    const colorOf = v => (yellowSide(v) ? (cb() ? CB_FIRST : YELLOW) : (cb() ? CB_OTHER : RED));
    const markOf = v => (!cb() ? null : yellowSide(v) ? 'dot' : 'cross');
    const sideName = first => (cb() ? (first ? 'Orange' : 'Blue') : (first ? 'Yellow' : 'Red'));
    const nameOf = v => (mode === '2p' ? sideName(v === 1) : v === me ? 'You' : mode === 'cpu' ? 'The computer' : peerName);
    const LK = () => LOOKS[S.look.theme] || LOOKS.arcade;
    const classic = () => S.cols === 7 && S.rows === 6 && !S.pop;
    const sizeId = () => `${S.cols}x${S.rows}`;
    /* the record against the computer: '7x6-2', '8x7p-3'; 'Medium', '8×7 Pop Out · Hard' */
    const recKey = (lv = S.lowest) => `${sizeId()}${S.pop ? 'p' : ''}-${lv}`;
    const recLabel = (lv = S.lowest) => (classic() ? LEVELS[lv].name : `${S.cols}×${S.rows}${S.pop ? ' Pop Out' : ''} · ${LEVELS[lv].name}`);

    /* ------------------------------ the page ------------------------------ */
    const boardEl = h('div.arx-bg__board');
    const sr = h('div.arx-bg__sr', { 'aria-live': 'polite' });
    const statusEl = h('div.arx-bg__status', { role: 'status' });
    const topStrip = playerStrip(RED, '', '');
    const botStrip = playerStrip(YELLOW, '', '');
    const sizeSeg = mode !== 'online' ? segment('Size', SIZES.map(([c, r]) => ({ id: `${c}x${r}`, label: `${c}×${r}`, title: `${c} columns, ${r} rows${c === 7 && r === 6 ? ' (the standard board)' : ''}` })), sizeId(), setSize) : null;
    const rulesSeg = mode !== 'online' ? segment('Rules', [{ id: 'drop', label: 'Classic', title: 'Drop discs only' }, { id: 'pop', label: 'Pop Out', title: 'Drop a disc, or pop one of your own out of the bottom row' }], S.pop ? 'pop' : 'drop', setRules) : null;
    const levelSeg = mode === 'cpu' ? segment('Level', [1, 2, 3].map(id => ({ id, label: LEVELS[id].name })), S.level, setLevel) : null;
    const recLine = mode === 'cpu' ? recordLine() : null;
    const firstSeg = mode === 'cpu' ? segment('First', [{ id: 'me', label: 'You' }, { id: 'cpu', label: 'Computer' }], S.first, setFirst) : null;
    const undoBtn = mode !== 'online' ? button('Undo', 'corner-up-left', () => { undo(); refocus(); }, { title: 'Take back the last move (U)' }) : null;
    const resignBtn = mode !== '2p' ? confirmButton('Resign', 'Resign? Click again', 'x', () => { resign(); refocus(); }) : null;
    const hintBtn = mode !== 'online' ? button('Hint', 'sparkles', () => { hint(); refocus(); }, { title: 'Mark the strongest move the computer can find (H)' }) : null;
    const refocus = () => el.closest('[tabindex]')?.focus({ preventScroll: true });
    const opts = boardOptions(boardEl, {
      samples: SAMPLES, coords: true,
      get: () => S.look,
      set: (k, v) => { S.look = { ...S.look, [k]: v }; writePrefs({ [k]: v }); paint(); },
      get rules() { return rulesText(); },
      refocus,
    });
    const note = h('div.arx-bg__note');
    const side = h('div.arx-bg__side', topStrip.el, statusEl, sizeSeg?.el, rulesSeg?.el, levelSeg?.el, recLine?.el, firstSeg?.el,
      h('div.arx-bg__row', undoBtn, resignBtn), h('div.arx-bg__row', hintBtn, opts.button), note, botStrip.el);
    const root = h('div.arx-bgc', h('style', { text: KIT_CSS }), h('div.arx-bg', boardEl, side), sr);
    el.appendChild(root);
    const sf = surface(boardEl, 'Connect Four board', () => draw());
    const loop = looper(() => draw());

    const link = NET ? duelLink(NET, {
      plies: () => S.g.moves.length,
      mine: i => S.by[i] === 'me',
      wire: i => ({ c: S.g.moves[i] }),
      take: d => {
        if (S.over || S.g.turn !== -me || !Number.isInteger(d.c) || !canPlay(S.g, d.c)) return false;
        apply(d.c, 'peer');
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
    function newGame() {
      brain?.cancel();
      clearTimeout(S.endT);
      Object.assign(S, {
        g: freshGame(1, { cols: S.cols, rows: S.rows, pop: S.pop }), by: [], over: null, line: null, drops: [], pops: [], thinking: false, myMoves: 0, ended: false,
        cursor: Math.floor(S.cols / 2), hint: null, hints: 0, hinting: false, lowest: S.level,
      });
      S.thinkId++;
      S.hintId++;
      ctx.onScore(0);
      NET?.peerScore?.(0);
      paint();
      if (mode === 'cpu' && S.g.turn !== me) computerMove();
    }
    const falling = () => S.drops.some(d => performance.now() - d.t0 < d.dur) || S.pops.some(d => performance.now() - d.t0 < d.dur);
    const canAct = () => !dead && !S.over && !S.thinking && (mode === '2p' || S.g.turn === me);
    const nope = () => { S.shake = performance.now(); snd.blip(140, 0.08, 'sawtooth', 0.4); loop.kick(0.25); };

    function tryDrop(col) {
      if (!canAct()) return false;
      if (!canPlay(S.g, col)) { nope(); return false; }
      apply(col, 'me');
      link?.sendMove(S.g.moves.length - 1);
      return true;
    }
    function tryPop(col) {
      if (!canAct() || !S.pop) return false;
      if (!canPop(S.g, col)) {
        nope();
        say(col >= 0 && col < S.cols ? `You can only pop one of your own discs from the bottom row; column ${col + 1}’s bottom disc is ${S.g.h[col] ? 'not yours' : 'missing'}.` : 'No such column.');
        return false;
      }
      apply(-1 - col, 'me');
      return true;
    }
    /* drop the hint the moment anything moves */
    function dropHint() {
      S.hint = null;
      S.hintId++;
      if (S.hinting) { S.hinting = false; brain?.cancel(); }
    }

    /* m: a column to drop in, or -1 - column to pop (Pop Out) */
    function apply(m, by) {
      const g = S.g;
      const v = g.turn;
      const isPop = m < 0, col = isPop ? -1 - m : m;
      dropHint();
      applyMove(g, m);
      S.by.push(by);
      if (by === 'me') S.myMoves++;
      let dur;
      if (isPop) {
        dur = reduced ? 0 : 280;
        S.pops = S.pops.filter(d => performance.now() - d.t0 < d.dur);
        S.pops.push({ col, v, t0: performance.now(), dur });
        snd.blip(220, 0.09, 'triangle', 0.7, 140);
      } else {
        const row = g.h[col] - 1;
        const fall = S.rows - row;
        dur = reduced ? 0 : Math.round(120 + 70 * Math.sqrt(fall));
        S.drops = S.drops.filter(d => performance.now() - d.t0 < d.dur);
        S.drops.push({ col, row, v, t0: performance.now(), dur });
        snd.blip(300 + row * 40, 0.06, 'triangle', 0.7);
      }
      loop.kick(dur / 1000 + 0.05);
      const o = outcome(g);
      if (o.over) { S.over = o; S.line = o.line; }
      const told = `${nameOf(v)} ${isPop ? 'popped a disc out of the bottom of' : 'dropped a disc in'} column ${col + 1}.${o.over ? ' ' + overText() : ''}`;
      say(told);
      /* the other side's move, for a screen reader (the shell's live region): yours you just made */
      if (by !== 'me' || mode === '2p') ctx.announce?.(told);
      paint();
      if (S.over) {
        if (S.line) loop.kick(2.5);
        finishSoon(dur);
      } else if (mode === 'cpu' && g.turn !== me) computerMove(dur);
    }

    const ask = level => ({ game: 'c4', cells: Array.from(S.g.cells), h: Array.from(S.g.h), turn: S.g.turn, moves: S.g.moves.slice(), cols: S.cols, rows: S.rows, pop: S.pop, level });
    const answerOf = res => (!res ? null : Number.isInteger(res.move) ? res.move : Number.isInteger(res.col) ? res.col : null);
    async function computerMove(waitFall = 0) {
      const id = ++S.thinkId;
      S.thinking = true;
      paint();
      const t0 = performance.now();
      const res = await brain.ask(ask(S.level));
      if (dead || id !== S.thinkId) return;
      const wait = Math.max(MIN_THINK_MS, waitFall + 80) - (performance.now() - t0);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      if (dead || id !== S.thinkId) return;
      S.thinking = false;
      const m = answerOf(res);
      if (m === null || !isLegal(S.g, m)) {
        statusEl.textContent = 'The computer could not move. Press Undo or start again.';
        statusEl.classList.add('is-alert');
        return;
      }
      apply(m, 'cpu');
    }

    /* the strongest level's move for the side to move, marked until the next move */
    async function hint() {
      if (!brain || !canAct() || S.hinting || falling()) return;
      const id = ++S.hintId;
      S.hinting = true;
      S.hint = null;
      paint();
      const res = await brain.ask(ask(3));
      if (dead || id !== S.hintId) return;
      S.hinting = false;
      const m = answerOf(res);
      if (m === null || !isLegal(S.g, m) || S.over) { say('No hint this time.'); paint(); return; }
      S.hint = m;
      S.hints++;
      const t = `Hint: ${m >= 0 ? `drop a disc in column ${m + 1}` : `pop your disc out of column ${-m}`}.`;
      say(t);
      ctx.announce?.(t);
      paint();
    }

    function undo() {
      if (mode === 'online' || S.over || dead) return;
      const g = S.g;
      if (mode === '2p') {
        if (!g.moves.length) return;
        unplay(g); S.by.pop();
      } else {
        const mine = S.by.lastIndexOf('me');
        if (mine < 0) return;
        if (S.thinking) { brain.cancel(); S.thinkId++; S.thinking = false; }
        while (g.moves.length > mine) { unplay(g); if (S.by.pop() === 'me') S.myMoves--; }
      }
      dropHint();
      S.drops = [];
      S.pops = [];
      snd.blip(330, 0.07, 'triangle', 0.6, 220);
      say('Move taken back.');
      paint();
    }

    function resign() {
      if (S.over || dead) return;
      if (S.thinking) { brain?.cancel(); S.thinkId++; S.thinking = false; }
      dropHint();
      S.over = { over: true, winner: -me, reason: 'resign', who: 'me' };
      link?.resign();
      say('You resigned.');
      paint();
      finishSoon();
    }

    function finishSoon(after = 0) {
      clearTimeout(S.endT);
      S.endT = setTimeout(finish, after + (reduced ? 300 : 1100));
    }
    function finish() {
      if (S.ended || dead || !S.over) return;
      S.ended = true;
      paint();
      const o = S.over, discs = S.g.moves.length;
      if (mode === 'online') {
        const won = o.winner === 0 ? null : o.winner === me;
        const detail = o.reason === 'resign' ? (o.who === 'me' ? 'You resigned.' : `${peerName} resigned.`)
          : o.winner === 0 ? 'The board is full: a draw.' : `Four in a row after ${discs} discs. You ${me === 1 ? 'went first' : 'went second'}.`;
        ctx.onEnd({ score: null, won, versus: { me: won === null ? 0.5 : won ? 1 : 0, them: won === null ? 0.5 : won ? 0 : 1 }, detail });
        return;
      }
      if (mode === '2p') {
        ctx.onEnd({ score: null, detail: o.winner === 0 ? drawText() : `${nameOf(o.winner)} wins with four in a row${o.reason === 'both' ? ' (a pop that made four for both sides)' : ''}.` });
        return;
      }
      const lv = LEVELS[S.lowest].name, where = classic() ? '' : ` on ${S.cols}×${S.rows}${S.pop ? ' Pop Out' : ''}`;
      const assisted = S.hints > 0;
      const helped = assisted ? ` You used ${S.hints === 1 ? 'a hint' : `${S.hints} hints`}, so it doesn’t set a best.` : '';
      const vs = { key: recKey(), label: recLabel(), result: o.winner === me ? 'win' : o.winner === 0 ? 'draw' : 'loss' };
      const extra = { vs, ...(assisted ? { assisted: true } : {}) };
      if (o.winner === me) ctx.onEnd({ score: classic() ? S.myMoves : null, won: true, detail: `Four in a row with ${S.myMoves} ${S.pop ? 'moves' : 'discs'} against the computer (${lv})${where}.${helped}`, ...extra });
      else if (o.winner === 0) ctx.onEnd({ score: null, won: false, detail: `${drawText()} Against the computer (${lv})${where}.${helped}`, ...extra });
      else ctx.onEnd({ score: null, won: false, detail: (o.reason === 'resign' ? `You resigned against the computer (${lv})${where}.` : `The computer (${lv}) made four in a row${where}.`) + helped, ...extra });
      /* the shell has just written the record (records.recordVs) */
      recLine?.set(records.vsOf('connect4', vs.key), vs.label);
    }

    function setLevel(v) {
      S.level = v;
      /* a game counts at the easiest level it was played at */
      S.lowest = S.myMoves ? Math.min(S.lowest, v) : v;
      writePrefs({ level: v }); levelSeg.set(v); paint(); refocus();
    }
    function setFirst(v) {
      S.first = v;
      writePrefs({ first: v });
      firstSeg.set(v);
      me = v === 'cpu' ? -1 : 1;
      newGame();
      refocus();
    }
    function setSize(v) {
      [S.cols, S.rows] = v.split('x').map(Number);
      writePrefs({ size: v });
      sizeSeg.set(v);
      newGame();
      refocus();
    }
    function setRules(v) {
      S.pop = v === 'pop';
      writePrefs({ pop: S.pop });
      rulesSeg.set(v);
      newGame();
      refocus();
    }

    /* ------------------------------ text ------------------------------ */
    function rulesText() {
      const board = `${S.cols} columns by ${S.rows} rows`;
      if (!S.pop) {
        return `Classic, ${board}. Drop a disc into a column and it falls to the lowest free hole. Four in a row across, down or diagonally wins; a full board with no four is a draw.`
          + (mode === 'online' ? ' Online games are always classic on 7 × 6.' : '');
      }
      return `Pop Out, ${board}. On your turn drop a disc, or pop one of your own discs out of the bottom row: every disc above it falls one place. `
        + 'Four in a row wins, a pop’s included. A pop that lines up four for your opponent alone is their win; four for both at once wins for whoever popped. '
        + 'A full board is not the end: the side to move pops. The same position coming round a third time with the same side to move is a draw.';
    }
    function noteText() {
      if (mode === 'online') return `Classic 7×6. Your discs are ${cb() ? 'orange, with a dot,' : 'yellow'} on your screen. Every move is checked on both screens.`;
      const pop = S.pop ? ' Pop Out: click the arrow under one of your bottom discs (or press P) to pop it. The full rules are under Board.' : '';
      if (mode === '2p') return `Two players on this screen: ${cb() ? 'Orange (a dot) goes first, Blue (a cross) second' : 'Yellow goes first'}, then take turns.${pop}`;
      return `Point at a column and click, or use ← → and Enter. 1–${S.cols} drop straight in.${pop}`;
    }
    function drawText() {
      const r = S.over?.reason;
      return r === 'repeat' ? 'The same position came round a third time: a draw.'
        : r === 'stuck' ? 'The board is full and there is nothing to pop: a draw.'
          : 'The board is full: a draw.';
    }
    function overText() {
      const o = S.over;
      if (!o) return '';
      if (o.winner === 0) return drawText();
      const both = o.reason === 'both' ? ' The pop made four for both sides, so it counts for the side that popped.' : '';
      if (mode === '2p') return `${nameOf(o.winner)} wins!${both}`;
      if (o.reason === 'resign') return o.who === 'me' ? 'You resigned.' : `${peerName} resigned — you win.`;
      return (o.winner === me ? 'Four in a row — you win!' : `${mode === 'cpu' ? 'The computer' : peerName} made four in a row.`) + both;
    }
    function say(t) { sr.textContent = t; }

    function paint() {
      if (dead) return;
      const g = S.g;
      let text;
      if (S.over) text = overText();
      else if (mode === 'cpu') text = g.turn === me ? (S.hinting ? 'Finding a hint…' : 'Your move') : 'The computer is thinking…';
      else if (mode === '2p') text = `${nameOf(g.turn)} to move${S.hinting ? ' — finding a hint…' : ''}`;
      else text = g.turn === me ? 'Your move' : `${peerName}’s move`;
      statusEl.textContent = text;
      statusEl.classList.remove('is-alert');
      statusEl.classList.toggle('is-done', !!S.over);
      const topV = mode === '2p' ? -1 : -me, botV = mode === '2p' ? 1 : me;
      const order = v => (v === 1 ? 'first' : 'second');
      topStrip.set({ name: mode === '2p' ? sideName(false) : mode === 'cpu' ? 'Computer' : peerName, note: mode === 'cpu' ? `${LEVELS[S.level].name} · goes ${order(topV)}` : `Goes ${order(topV)}`,
        color: colorOf(topV), turn: !S.over && g.turn === topV, thinking: S.thinking });
      botStrip.set({ name: mode === '2p' ? sideName(true) : 'You', note: `Goes ${order(botV)}`, color: colorOf(botV), turn: !S.over && g.turn === botV });
      if (undoBtn) undoBtn.disabled = !!S.over || (mode === '2p' ? !g.moves.length : !S.by.includes('me'));
      if (resignBtn) { resignBtn.disabled = !!S.over; if (S.over) resignBtn.reset(); }
      if (hintBtn) hintBtn.disabled = !canAct() || S.hinting;
      if (!S.ended) recLine?.set(records.vsOf('connect4', recKey(S.level)), recLabel(S.level));
      note.textContent = noteText();
      sf.cv.setAttribute('aria-label', `Connect Four board, ${S.cols} by ${S.rows}${S.pop ? ', Pop Out' : ''}. ${text}`);
      ctx.onScore(mode === '2p' ? g.moves.length : S.myMoves);
      if (NET) NET.peerScore?.(S.by.filter(b => b === 'peer').length);
      draw();
    }

    /* ------------------------------ drawing ------------------------------ */
    /* below the board: the pop arrows (Pop Out), then the column numbers (Coordinates) */
    function layout() {
      const C = S.cols, R = S.rows;
      const popH = S.pop ? 0.62 : 0, numH = S.look.coords ? 0.5 : 0;
      const cell = Math.max(16, Math.floor(Math.min(sf.w / (C + 0.4), sf.h / (R + 1.5 + popH + numH))));
      const x = Math.round((sf.w - cell * C) / 2);
      const y = Math.round((sf.h - cell * (R + 1 + popH + numH)) / 2 + cell * 1.05);
      const bottom = y + R * cell;
      return { cell, x, y, popY: S.pop ? bottom + cell * 0.14 : null, popH: cell * 0.44, numY: bottom + cell * (popH + 0.32) };
    }
    const cx = (L, c) => L.x + (c + 0.5) * L.cell;
    const cy = (L, r) => L.y + (S.rows - 1 - r + 0.5) * L.cell;       /* r: 0 = bottom */
    const colAt = x => { const L = S.geo; const c = Math.floor((x - L.x) / L.cell); return c >= 0 && c < S.cols ? c : -1; };
    /* is (x, y) on the pop arrows' strip under the board? */
    const inPopStrip = y => S.pop && S.geo.popY !== null && y >= S.geo.y + S.rows * S.geo.cell + 2;

    function disc(g, x, y, r, color, alpha = 1, mark = null) {
      g.save();
      g.globalAlpha = alpha;
      const gr = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
      gr.addColorStop(0, '#ffffff');
      gr.addColorStop(0.18, color);
      gr.addColorStop(1, shade(color));
      g.fillStyle = gr;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(0,0,0,.25)';
      g.lineWidth = Math.max(1, r * 0.1);
      g.beginPath(); g.arc(x, y, r * 0.68, 0, Math.PI * 2); g.stroke();
      /* the colour-blind set's marks: a dark dot on orange, a white cross on blue */
      if (mark === 'dot') {
        g.fillStyle = 'rgba(12,10,20,.8)';
        g.beginPath(); g.arc(x, y, r * 0.24, 0, Math.PI * 2); g.fill();
      } else if (mark === 'cross') {
        const k = r * 0.3;
        g.strokeStyle = 'rgba(255,255,255,.92)';
        g.lineWidth = Math.max(2, r * 0.16);
        g.lineCap = 'round';
        g.beginPath(); g.moveTo(x - k, y - k); g.lineTo(x + k, y + k); g.moveTo(x + k, y - k); g.lineTo(x - k, y + k); g.stroke();
      }
      g.restore();
    }
    /* a pop arrow under column c */
    function popTab(g, L, c, color, hot) {
      const w = L.cell * 0.62, x = cx(L, c) - w / 2, y = L.popY;
      g.save();
      g.globalAlpha = hot ? 1 : 0.72;
      g.fillStyle = color;
      rr(g, x, y, w, L.popH, L.popH * 0.35);
      g.fill();
      g.strokeStyle = hot ? LK().mark : 'rgba(0,0,0,.35)';
      g.lineWidth = hot ? 2 : 1;
      g.stroke();
      const m = cx(L, c), t = y + L.popH * 0.24, b = y + L.popH * 0.76, a = L.popH * 0.24;
      g.strokeStyle = 'rgba(10,10,20,.85)';
      g.lineWidth = Math.max(2, L.cell * 0.05);
      g.lineCap = 'round';
      g.beginPath(); g.moveTo(m, t); g.lineTo(m, b); g.moveTo(m - a, b - a); g.lineTo(m, b); g.lineTo(m + a, b - a); g.stroke();
      g.restore();
    }

    function draw() {
      if (dead) return;
      const g = sf.g;
      sf.begin();
      const L = S.geo = layout();
      const lk = LK();
      const C = S.cols, R = S.rows;
      const now = performance.now();
      g.fillStyle = lk.bg;
      g.fillRect(0, 0, sf.w, sf.h);
      if (lk.glow) {
        const glow = g.createRadialGradient(sf.w / 2, sf.h * 0.6, 0, sf.w / 2, sf.h * 0.6, Math.max(sf.w, sf.h) * 0.6);
        glow.addColorStop(0, lk.glow);
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = glow;
        g.fillRect(0, 0, sf.w, sf.h);
      }
      const Rd = L.cell * 0.4;
      const busy = falling();
      /* the disc waiting above the column */
      const col = S.kb ? S.cursor : S.hover;
      if (col >= 0 && canAct() && !busy && !(S.hoverPop && !S.kb)) {
        const v = S.g.turn;
        disc(g, cx(L, col), L.y - L.cell * 0.55, Rd, colorOf(v), canPlay(S.g, col) ? 0.9 : 0.25, markOf(v));
      }
      /* the hint, a ghost disc where it lands (behind the board, like the discs) */
      const showHint = S.hint !== null && !S.over && !busy;
      if (showHint && S.hint >= 0) disc(g, cx(L, S.hint), cy(L, S.g.h[S.hint]), Rd, colorOf(S.g.turn), 0.45, markOf(S.g.turn));
      /* discs (behind the board) */
      const drops = new Map();
      for (const d of S.drops) if (now - d.t0 < d.dur) drops.set(d.row * C + d.col, d);
      const pops = new Map();
      for (const d of S.pops) if (now - d.t0 < d.dur) pops.set(d.col, d);
      for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
        const v = S.g.cells[r * C + c];
        if (!v || drops.has(r * C + c)) continue;
        /* a popped column slides down one place */
        const p = pops.get(c);
        const lift = p ? L.cell * (1 - easeOut((now - p.t0) / p.dur)) : 0;
        disc(g, cx(L, c), cy(L, r) - lift, Rd, colorOf(v), 1, markOf(v));
      }
      for (const d of drops.values()) {
        const k = Math.min(1, (now - d.t0) / d.dur);
        const y0 = L.y - L.cell * 0.55, y1 = cy(L, d.row);
        disc(g, cx(L, d.col), y0 + (y1 - y0) * k * k, Rd, colorOf(d.v), 1, markOf(d.v));
      }
      for (const p of pops.values()) {
        /* the popped disc leaves through the bottom */
        const k = Math.min(1, (now - p.t0) / p.dur);
        disc(g, cx(L, p.col), cy(L, 0) + L.cell * 0.9 * k, Rd, colorOf(p.v), 1 - k, markOf(p.v));
      }
      /* the board, with its holes */
      let sx = 0;
      if (S.shake && now - S.shake < 200) sx = Math.sin((now - S.shake) / 18) * 4 * (1 - (now - S.shake) / 200);
      g.save();
      g.translate(sx, 0);
      if (lk.halo) { g.shadowBlur = 26; g.shadowColor = lk.halo; }
      const bg = g.createLinearGradient(0, L.y, 0, L.y + R * L.cell);
      bg.addColorStop(0, lk.board[0]);
      bg.addColorStop(1, lk.board[1]);
      g.fillStyle = bg;
      g.beginPath();
      rr(g, L.x - L.cell * 0.12, L.y - L.cell * 0.08, L.cell * (C + 0.24), L.cell * (R + 0.16), L.cell * 0.22);
      for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
        g.moveTo(cx(L, c) + Rd + 1, cy(L, r));
        g.arc(cx(L, c), cy(L, r), Rd + 1, 0, Math.PI * 2, true);
      }
      g.fill('evenodd');
      g.shadowBlur = 0;
      if (lk.rings) {
        /* high contrast: a ring round every hole */
        g.strokeStyle = lk.rings;
        g.lineWidth = 2;
        for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) { g.beginPath(); g.arc(cx(L, c), cy(L, r), Rd + 2, 0, Math.PI * 2); g.stroke(); }
      }
      g.restore();
      g.strokeStyle = lk.edge;
      g.lineWidth = lk.rings ? 2.5 : 1.5;
      rr(g, L.x - L.cell * 0.12 + sx, L.y - L.cell * 0.08, L.cell * (C + 0.24), L.cell * (R + 0.16), L.cell * 0.22);
      g.stroke();
      /* Pop Out: an arrow under each of the mover's bottom discs */
      if (S.pop && canAct() && !busy) {
        for (let c = 0; c < C; c++) {
          if (!canPop(S.g, c)) continue;
          const hot = (S.kb && S.cursor === c) || (!S.kb && S.hoverPop && S.hover === c) || (showHint && S.hint === -1 - c);
          popTab(g, L, c, colorOf(S.g.turn), hot);
        }
      }
      /* the hint's ring */
      if (showHint) {
        const hc = S.hint >= 0 ? S.hint : -1 - S.hint, hr = S.hint >= 0 ? S.g.h[S.hint] : 0;
        g.save();
        g.strokeStyle = lk.mark;
        g.lineWidth = Math.max(2.5, L.cell * 0.07);
        g.setLineDash([L.cell * 0.12, L.cell * 0.08]);
        g.beginPath(); g.arc(cx(L, hc), cy(L, hr), Rd + 3, 0, Math.PI * 2); g.stroke();
        g.restore();
      }
      /* the winning line */
      if (S.line && !busy) {
        const pulse = reduced ? 1 : 0.65 + 0.35 * Math.sin(now / 160);
        g.save();
        g.shadowBlur = 18;
        g.shadowColor = lk.mark;
        g.strokeStyle = lk.mark;
        g.globalAlpha = pulse;
        g.lineWidth = Math.max(2, L.cell * 0.08);
        for (const [r, c] of S.line) { g.beginPath(); g.arc(cx(L, c), cy(L, r), Rd * 0.98, 0, Math.PI * 2); g.stroke(); }
        g.restore();
      }
      /* the keyboard's column */
      if (S.kb && canAct()) {
        g.save();
        g.strokeStyle = lk.mark;
        g.globalAlpha = 0.55;
        g.lineWidth = 2;
        g.setLineDash([5, 5]);
        g.strokeRect(L.x + S.cursor * L.cell + 3, L.y - L.cell * 1.05, L.cell - 6, L.cell * (R + 1.05));
        g.restore();
      }
      /* column numbers */
      if (S.look.coords) {
        g.fillStyle = lk.ink;
        g.font = `700 ${Math.max(10, Math.round(L.cell * 0.3))}px Inter,system-ui,sans-serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        for (let c = 0; c < C; c++) g.fillText(String(c + 1), cx(L, c), L.numY);
      }
    }

    /* ------------------------------ input ------------------------------ */
    const at = e => { const r = sf.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const onDown = e => {
      if (e.button > 0 || dead) return;
      snd.wake();
      S.kb = false;
      const p = at(e), c = colAt(p.x);
      if (c < 0) return;
      S.hover = c;
      if (inPopStrip(p.y)) tryPop(c); else tryDrop(c);
    };
    const onMove = e => {
      const p = at(e), c = colAt(p.x), pp = inPopStrip(p.y);
      if (S.kb) { S.kb = false; }
      if (c !== S.hover || pp !== S.hoverPop) {
        S.hover = c; S.hoverPop = pp;
        sf.cv.style.cursor = c >= 0 && canAct() && (!pp || canPop(S.g, c)) ? 'pointer' : 'default';
        draw();
      }
    };
    const onLeave = () => { if (S.hover !== -1) { S.hover = -1; S.hoverPop = false; draw(); } };
    const onKey = e => {
      if (!ownsKey(el, e) || dead || S.ended || opts.isOpen()) return;
      const k = e.key;
      if (k === 'ArrowLeft' || k === 'ArrowRight') {
        e.preventDefault();
        snd.wake();
        S.kb = true;
        S.cursor = Math.max(0, Math.min(S.cols - 1, S.cursor + (k === 'ArrowLeft' ? -1 : 1)));
        draw();
        return;
      }
      if (k === 'Enter' || k === ' ' || k === 'ArrowDown') { e.preventDefault(); snd.wake(); S.kb = true; tryDrop(S.cursor); return; }
      if (/^[1-9]$/.test(k) && Number(k) <= S.cols) { e.preventDefault(); snd.wake(); S.cursor = Number(k) - 1; S.kb = true; tryDrop(S.cursor); return; }
      if (S.pop && (k === 'p' || k === 'P' || k === 'ArrowUp')) { e.preventDefault(); snd.wake(); S.kb = true; tryPop(S.cursor); return; }
      if ((k === 'h' || k === 'H') && hintBtn) { e.preventDefault(); hint(); return; }
      if ((k === 'u' || k === 'U' || k === 'z' || k === 'Z' || k === 'Backspace') && mode !== 'online') { e.preventDefault(); undo(); }
    };
    window.addEventListener('keydown', onKey);
    sf.cv.addEventListener('pointerdown', onDown);
    sf.cv.addEventListener('pointermove', onMove);
    sf.cv.addEventListener('pointerleave', onLeave);

    newGame();

    const id = v => (v === 1 ? 1 : v === -1 ? 2 : 0);
    const rowsText = () => {
      const out = [];
      for (let r = S.rows - 1; r >= 0; r--) {
        let s = '';
        for (let c = 0; c < S.cols; c++) { const v = S.g.cells[r * S.cols + c]; s += v === 1 ? '1' : v === -1 ? '2' : '.'; }
        out.push(s);
      }
      return out;
    };
    return {
      stop() {
        dead = true;
        clearTimeout(S.endT);
        brain?.close();
        link?.stop();
        loop.stop();
        opts.close();
        window.removeEventListener('keydown', onKey);
        sf.cv.removeEventListener('pointerdown', onDown);
        sf.cv.removeEventListener('pointermove', onMove);
        sf.cv.removeEventListener('pointerleave', onLeave);
        resignBtn?.reset();
        snd.close();
        sf.destroy();
        root.remove();
      },
      /* what a watcher may see (./spectate.js): the board top row first, '1' = the first mover */
      spectate: () => {
        const first = mode === '2p' ? 'Yellow' : me === 1 ? 'You' : (mode === 'cpu' ? 'Computer' : peerName);
        const second = mode === '2p' ? 'Red' : me === -1 ? 'You' : (mode === 'cpu' ? 'Computer' : peerName);
        return { k: 'board', st: 'c4', w: S.cols, h: S.rows, cells: rowsText().join(''), hl: [], txt: statusEl.textContent, over: !!S.over, x: null, turn: S.over ? 0 : S.g.turn,
          pl: [{ n: first, m: 'Yellow' }, { n: second, m: 'Red' }] };
      },
      /* moves: one character a move — a digit drops in that column (0 = the first), a letter pops one (a = the first) */
      peek: () => ({
        mode, me: mode === '2p' ? null : id(me), turn: id(S.g.turn), grid: rowsText(),
        moves: S.g.moves.map(m => (m >= 0 ? String(m) : String.fromCharCode(97 - 1 - m))).join(''), plies: S.g.moves.length,
        over: S.over ? { winner: id(S.over.winner), reason: S.over.reason || 'four' } : null, line: S.line,
        level: S.level, lowest: S.lowest, first: S.first, thinking: S.thinking, worker: !!brain?.worker, rejected: S.rejected,
        dropping: falling(), cursor: S.cursor, myMoves: S.myMoves, ended: S.ended, geo: { ...S.geo }, status: statusEl.textContent,
        palette: cb() ? 'cb' : 'standard', colors: { 1: colorOf(1), 2: colorOf(-1) }, marks: { 1: markOf(1), 2: markOf(-1) },
        cols: S.cols, rows: S.rows, pop: S.pop, legal: S.over ? [] : legalMoves(S.g),
        hint: S.hint, hints: S.hints, hinting: S.hinting, look: { ...S.look }, theme: LK(), rules: rulesText(), note: note.textContent,
        record: { key: recKey(S.level), label: recLabel(S.level) },
      }),
    };
  },
};

const easeOut = k => { const t = Math.max(0, Math.min(1, k)); return 1 - (1 - t) * (1 - t); };
/* a darker edge for a disc colour (#rrggbb) */
function shade(hex) {
  const n = parseInt(hex.slice(1), 16);
  const f = v => Math.round(v * 0.55).toString(16).padStart(2, '0');
  return `#${f(n >> 16)}${f((n >> 8) & 255)}${f(n & 255)}`;
}
