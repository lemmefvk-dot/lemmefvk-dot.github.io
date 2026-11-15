/* ============================================================
   arcade/ttt.js — Tic-Tac-Toe for Static Arcade.

   Classic 3 × 3, and Ultimate: nine small boards in one big one,
   where the square you play in picks the small board your opponent
   must play in next (rules and computer in ./ttt-rules.js). That
   board is outlined in the colour of the side to move and named in
   the status line; when the choice is free every open board is lit.
   The first time Ultimate is opened a short walk-through explains the
   rule (skippable; "How to play" brings it back; remembered in
   portal.arcadeTtt as ultSeen).

   · 1P: against the computer (Easy, Medium, Hard — Hard is perfect
     minimax on the 3 × 3 board and never loses), you or the
     computer first; Classic or Ultimate. Level, first, board and the
     look are remembered in portal.arcadeTtt. The search runs in a
     Web Worker. Undo takes back your move and its reply. Hint asks
     Hard for your move and marks it; a game with a hint never sets a
     best. Your won / lost / drawn record against each board and level
     is under the Level row (./records.js; games played to the end,
     resigning counts as lost, a game counts at the easiest level it
     was played at).
   · 2P: X and O take turns on one screen (Hint works too).
   · Online: a friend on another device through the Arcade's room.
     Classic 3 × 3 only. The host is X (moves first) in odd rounds,
     the guest in even ones; on your screen you are always blue.
     Every arriving move is checked (whose turn, an empty square)
     before it reaches the board; anything else is ignored.

   Mouse or touch: click a square. Keyboard: arrow keys move the
   cursor, Enter / Space place a mark, 1–9 place straight into a
   classic square (like a phone's keypad: 1 top left, 9 bottom
   right), H hint, U / Z / Backspace undo. With Coordinates on, the
   columns are lettered and the rows numbered (a1 top left) and moves
   are read out by those names.
   Score in 1P Classic: a win scores the marks it took (fewer is
   better); Ultimate wins don't score.
   ============================================================ */
import { h } from '../core/dom.js';
import { store } from '../core/store.js';
import * as T from './ttt-rules.js';
import { thinker } from './thinker.js';
import * as records from './records.js';
import { KIT_CSS, surface, ownsKey, sounder, looper, playerStrip, segment, button, confirmButton, duelLink, boardOptions, lookOf, recordLine } from './boardkit.js';

const PREF = 'portal.arcadeTtt';
const BLUE = '#4dd2ff', PINK = '#ff4d6d';
const MIN_THINK_MS = 340;
const BOARD_NAMES = ['top-left', 'top', 'top-right', 'left', 'centre', 'right', 'bottom-left', 'bottom', 'bottom-right'];
/* the board's four looks (boardkit's BOARD_THEMES); 'arcade' is the original */
const LOOKS = {
  arcade: { bg: '#05060d', glow: 'hsla(190,90%,45%,.16)', big: 'rgba(160,200,255,.8)', small: 'rgba(160,200,255,.28)', you: BLUE, them: PINK, neon: true, live: 'rgba(255,255,255,.1)', idle: 'rgba(255,255,255,.04)', full: 'rgba(255,255,255,.12)', mark: '#ffffff', ink: 'rgba(200,225,255,.8)' },
  wood: { bg: '#24170c', glow: 'hsla(30,70%,40%,.22)', big: 'rgba(255,226,180,.85)', small: 'rgba(255,226,180,.3)', you: '#7fe0ff', them: '#ff7f95', neon: true, live: 'rgba(255,236,200,.12)', idle: 'rgba(255,236,200,.05)', full: 'rgba(255,236,200,.12)', mark: '#fff7e6', ink: 'rgba(255,230,190,.85)' },
  paper: { bg: '#f3eee2', glow: null, big: '#2b2b36', small: 'rgba(43,43,54,.35)', you: '#1d63c4', them: '#c42c52', neon: false, live: 'rgba(29,99,196,.1)', idle: 'rgba(0,0,0,.04)', full: 'rgba(0,0,0,.08)', mark: '#000000', ink: '#33333d' },
  contrast: { bg: '#000000', glow: null, big: '#ffffff', small: 'rgba(255,255,255,.6)', you: '#3ad0ff', them: '#ff5c8a', neon: false, live: 'rgba(255,230,0,.18)', idle: 'rgba(255,255,255,.06)', full: 'rgba(255,255,255,.2)', mark: '#ffe600', ink: '#ffffff', thick: true },
};
const SAMPLES = { arcade: ['#4dd2ff', '#05060d'], wood: ['#ffe2b4', '#24170c'], paper: ['#2b2b36', '#f3eee2'], contrast: ['#ffffff', '#000000'] };

/* the Ultimate walk-through: what each step says, and what its little board shows */
const TUTORIAL = [
  { title: 'Ultimate Tic-Tac-Toe', text: 'Nine small boards make one big board. Take a small board with three in a row inside it. Take three small boards in a row and you win the game.', show: 'won' },
  { title: 'Your square sends them', text: 'Where you play inside a small board picks the small board your opponent must play in next. Take the top-right square, and they must play in the top-right board.', show: 'send' },
  { title: 'A finished board frees the choice', text: 'If that board is already won or full, your opponent may play in any open board instead.', show: 'free' },
  { title: 'Watch for the outline', text: 'The board you must play in is outlined in your colour, and the status line names it. When the choice is free, every open board is lit.', show: 'outline' },
];

const readPrefs = () => {
  let p = null;
  try { p = store.get(PREF, null); } catch (err) { p = null; }
  return { level: [1, 2, 3].includes(p?.level) ? p.level : 2, first: p?.first === 'cpu' ? 'cpu' : 'me', ult: !!p?.ult, ultSeen: p?.ultSeen === true, ...lookOf(p) };
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
    /* 1 = X, who moves first; `me` is my mark's value (2P: none) */
    let me = mode === 'online' ? ((round % 2 === 1) === host ? 1 : -1) : mode === 'cpu' ? (prefs.first === 'cpu' ? -1 : 1) : 0;
    let dead = false;

    const S = {
      ult: mode === 'online' ? false : prefs.ult, g: T.newGame(false), by: [], over: null, hover: -1, cursor: 4, kb: false, thinking: false, thinkId: 0,
      level: prefs.level, lowest: prefs.level, first: prefs.first, rejected: 0, myMoves: 0, ended: false, endT: 0, geo: { x: 0, y: 0, size: 0 }, shake: 0, placed: new Map(),
      look: lookOf(prefs), hint: null, hints: 0, hintId: 0, hinting: false, tut: null, cpuWaits: false,
    };
    const LK = () => LOOKS[S.look.theme] || LOOKS.arcade;
    const name = v => (v === 1 ? 'X' : 'O');
    const colorOf = v => (mode === '2p' ? (v === 1 ? LK().you : LK().them) : v === me ? LK().you : LK().them);
    const nameOf = v => (mode === '2p' ? `Player ${name(v)}` : v === me ? 'You' : mode === 'cpu' ? 'The computer' : peerName);
    const recKey = (lv = S.lowest) => `${S.ult ? 'u' : 'c'}-${lv}`;
    const recLabel = (lv = S.lowest) => `${S.ult ? 'Ultimate' : 'Classic'} · ${T.LEVELS[lv].name}`;

    /* ------------------------------ the page ------------------------------ */
    const boardEl = h('div.arx-bg__board');
    const sr = h('div.arx-bg__sr', { 'aria-live': 'polite' });
    const statusEl = h('div.arx-bg__status', { role: 'status' });
    const topStrip = playerStrip(PINK, '', '');
    const botStrip = playerStrip(BLUE, '', '');
    const levelSeg = mode === 'cpu' ? segment('Level', [1, 2, 3].map(id => ({ id, label: T.LEVELS[id].name })), S.level, setLevel) : null;
    const recLine = mode === 'cpu' ? recordLine() : null;
    const firstSeg = mode === 'cpu' ? segment('First', [{ id: 'me', label: 'You' }, { id: 'cpu', label: 'Computer' }], S.first, setFirst) : null;
    const boardSeg = mode !== 'online' ? segment('Board', [{ id: 'c', label: 'Classic 3×3' }, { id: 'u', label: 'Ultimate 9×9' }], S.ult ? 'u' : 'c', setBoard) : null;
    const undoBtn = mode !== 'online' ? button('Undo', 'corner-up-left', () => { undo(); refocus(); }, { title: 'Take back the last move (U)' }) : null;
    const resignBtn = mode !== '2p' ? confirmButton('Resign', 'Resign? Click again', 'x', () => { resign(); refocus(); }) : null;
    const hintBtn = mode !== 'online' ? button('Hint', 'sparkles', () => { hint(); refocus(); }, { title: 'Mark the strongest move the computer can find (H)' }) : null;
    const howBtn = mode !== 'online' ? button('How to play', 'help-circle', () => openTutorial(0), { title: 'How Ultimate works, step by step', 'aria-haspopup': 'dialog' }) : null;
    const refocus = () => el.closest('[tabindex]')?.focus({ preventScroll: true });
    const opts = boardOptions(boardEl, {
      samples: SAMPLES, coords: true,
      get: () => S.look,
      set: (k, v) => { S.look = { ...S.look, [k]: v }; writePrefs({ [k]: v }); paint(); },
      get rules() { return rulesText(); },
      refocus,
    });
    const note = h('div.arx-bg__note', {
      text: mode === 'online' ? 'Classic 3×3. You are blue on your screen. Every move is checked on both screens.'
        : mode === '2p' ? 'Two players on this screen: X goes first, then take turns.'
          : 'Click a square, or use the arrow keys and Enter. 1–9 play a classic square straight away.',
    });
    const side = h('div.arx-bg__side', topStrip.el, statusEl, boardSeg?.el, levelSeg?.el, recLine?.el, firstSeg?.el,
      h('div.arx-bg__row', undoBtn, resignBtn), h('div.arx-bg__row', hintBtn, opts.button), howBtn ? h('div.arx-bg__row', howBtn) : null, note, botStrip.el);
    const root = h('div.arx-bgc', h('style', { text: KIT_CSS }), h('div.arx-bg', boardEl, side), sr);
    el.appendChild(root);
    const sf = surface(boardEl, 'Tic-Tac-Toe board', () => draw());
    const loop = looper(() => draw());

    const link = NET ? duelLink(NET, {
      plies: () => S.g.moves.length,
      mine: i => S.by[i] === 'me',
      wire: i => ({ c: S.g.moves[i] }),
      take: d => {
        if (S.over || S.g.turn !== -me || !Number.isInteger(d.c) || !T.canPlay(S.g, d.c)) return false;
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
      Object.assign(S, { g: T.newGame(S.ult), by: [], over: null, thinking: false, myMoves: 0, ended: false, cursor: S.ult ? 40 : 4, placed: new Map(),
        hint: null, hints: 0, hinting: false, lowest: S.level, cpuWaits: false });
      S.thinkId++;
      S.hintId++;
      ctx.onScore(0);
      NET?.peerScore?.(0);
      paint();
      cpuTurn();
    }
    /* the computer's turn — held while the walk-through is open */
    function cpuTurn() {
      if (mode !== 'cpu' || S.over || S.g.turn === me) return;
      if (S.tut) { S.cpuWaits = true; return; }
      computerMove();
    }
    const canAct = () => !dead && !S.over && !S.thinking && !S.tut && (mode === '2p' || S.g.turn === me);
    /* drop the hint the moment anything moves */
    function dropHint() {
      S.hint = null;
      S.hintId++;
      if (S.hinting) { S.hinting = false; brain?.cancel(); }
    }

    function tryPlace(i) {
      if (!canAct()) return false;
      if (!T.canPlay(S.g, i)) {
        S.shake = performance.now();
        snd.blip(140, 0.08, 'sawtooth', 0.4);
        loop.kick(0.25);
        return false;
      }
      apply(i, 'me');
      link?.sendMove(S.g.moves.length - 1);
      return true;
    }

    function apply(i, by) {
      const g = S.g, v = g.turn;
      dropHint();
      T.play(g, i);
      S.by.push(by);
      if (by === 'me') S.myMoves++;
      S.placed.set(i, performance.now());
      loop.kick(reduced ? 0.05 : 0.4);
      snd.blip(v === 1 ? 420 : 330, 0.06, 'triangle', 0.7);
      const o = T.outcome(g);
      if (o.over) S.over = o;
      const told = `${nameOf(v)} played ${cellName(i)}.${o.over ? ' ' + overText() : ''}`;
      say(told);
      /* the other side's move, for a screen reader (the shell's live region): yours you just made */
      if (by !== 'me' || mode === '2p') ctx.announce?.(told);
      paint();
      if (S.over) { loop.kick(2.5); finishSoon(); }
      else cpuTurn();
    }
    /* with Coordinates on, a square is named as drawn (b2, e5); otherwise as before */
    const coordName = i => { const n = N(); return `${'abcdefghi'[i % n]}${Math.floor(i / n) + 1}`; };
    const cellName = i => (S.look.coords ? coordName(i) : S.ult ? `row ${Math.floor(i / 9) + 1}, column ${(i % 9) + 1}` : `square ${i + 1}`);

    const ask = level => ({ game: 'ttt', ult: S.ult, moves: S.g.moves.slice(), level });
    async function computerMove() {
      const id = ++S.thinkId;
      S.thinking = true;
      paint();
      const t0 = performance.now();
      const res = await brain.ask(ask(S.level));
      if (dead || id !== S.thinkId) return;
      const wait = MIN_THINK_MS - (performance.now() - t0);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      if (dead || id !== S.thinkId) return;
      S.thinking = false;
      if (!res || !T.canPlay(S.g, res.move)) {
        statusEl.textContent = 'The computer could not move. Press Undo or start again.';
        statusEl.classList.add('is-alert');
        return;
      }
      apply(res.move, 'cpu');
    }

    /* the strongest level's move for the side to move, marked until the next move */
    async function hint() {
      if (!brain || !canAct() || S.hinting) return;
      const id = ++S.hintId;
      S.hinting = true;
      S.hint = null;
      paint();
      const res = await brain.ask(ask(3));
      if (dead || id !== S.hintId) return;
      S.hinting = false;
      if (!res || !T.canPlay(S.g, res.move) || S.over) { say('No hint this time.'); paint(); return; }
      S.hint = res.move;
      S.hints++;
      const t = `Hint: play ${cellName(res.move)}.`;
      say(t);
      ctx.announce?.(t);
      paint();
    }

    function undo() {
      if (mode === 'online' || S.over || dead) return;
      const g = S.g;
      if (mode === '2p') {
        if (!g.moves.length) return;
        T.undo(g); S.by.pop();
      } else {
        const mine = S.by.lastIndexOf('me');
        if (mine < 0) return;
        if (S.thinking) { brain.cancel(); S.thinkId++; S.thinking = false; }
        while (g.moves.length > mine) { T.undo(g); if (S.by.pop() === 'me') S.myMoves--; }
      }
      dropHint();
      S.placed = new Map();
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

    function finishSoon() {
      clearTimeout(S.endT);
      S.endT = setTimeout(finish, reduced ? 300 : 1100);
    }
    function finish() {
      if (S.ended || dead || !S.over) return;
      S.ended = true;
      paint();
      const o = S.over, marks = S.myMoves;
      if (mode === 'online') {
        const won = o.winner === 0 ? null : o.winner === me;
        const detail = o.reason === 'resign' ? (o.who === 'me' ? 'You resigned.' : `${peerName} resigned.`)
          : o.winner === 0 ? 'The board is full: a draw.' : `Three in a row. You played ${me === 1 ? 'X (first)' : 'O (second)'}.`;
        ctx.onEnd({ score: null, won, versus: { me: won === null ? 0.5 : won ? 1 : 0, them: won === null ? 0.5 : won ? 0 : 1 }, detail });
        return;
      }
      if (mode === '2p') {
        ctx.onEnd({ score: null, detail: o.winner === 0 ? 'The board is full: a draw.' : `${nameOf(o.winner)} wins${S.ult ? ' the big board' : ''}.` });
        return;
      }
      const lv = T.LEVELS[S.lowest].name, kind = S.ult ? 'Ultimate' : 'Classic';
      const assisted = S.hints > 0;
      const helped = assisted ? ` You used ${S.hints === 1 ? 'a hint' : `${S.hints} hints`}, so it doesn’t set a best.` : '';
      const vs = { key: recKey(), label: recLabel(), result: o.winner === me ? 'win' : o.winner === 0 ? 'draw' : 'loss' };
      const extra = { vs, ...(assisted ? { assisted: true } : {}) };
      if (o.winner === me) ctx.onEnd({ score: S.ult ? null : marks, won: true, detail: `You won ${kind} against the computer (${lv})${S.ult ? '' : ` with ${marks} marks`}.${helped}`, ...extra });
      else if (o.winner === 0) ctx.onEnd({ score: null, won: false, detail: `A draw in ${kind} against the computer (${lv}).${helped}`, ...extra });
      else ctx.onEnd({ score: null, won: false, detail: (o.reason === 'resign' ? `You resigned against the computer (${lv}).` : `The computer (${lv}) won ${kind}.`) + helped, ...extra });
      /* the shell has just written the record (records.recordVs) */
      recLine?.set(records.vsOf('ttt', vs.key), vs.label);
    }

    function setLevel(v) {
      S.level = v;
      /* a game counts at the easiest level it was played at */
      S.lowest = S.myMoves ? Math.min(S.lowest, v) : v;
      writePrefs({ level: v }); levelSeg.set(v); paint(); refocus();
    }
    function setFirst(v) {
      S.first = v; writePrefs({ first: v }); firstSeg.set(v);
      me = v === 'cpu' ? -1 : 1;
      newGame(); refocus();
    }
    function setBoard(v) {
      S.ult = v === 'u'; writePrefs({ ult: S.ult }); boardSeg.set(v);
      if (S.ult && !readPrefs().ultSeen) openTutorial(0);
      newGame();
      if (!S.tut) refocus();
    }

    /* ------------------------------ the Ultimate walk-through ------------------------------ */
    function openTutorial(step = 0) {
      closeTutorial(false);
      opts.close();
      const box = h('div.arc-ov__card');
      const ov = h('div.arx-bg__dlg', {
        role: 'dialog', 'aria-modal': 'true', 'aria-label': 'How to play Ultimate Tic-Tac-Toe', dataset: { k: 'tutorial' },
        onkeydown: e => {
          e.stopPropagation();
          if (e.key === 'Escape') { e.preventDefault(); closeTutorial(true); }
          else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
          else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
        },
      }, box);
      S.tut = { step, el: ov, box };
      boardEl.appendChild(ov);
      paintTutorial();
      paint();
    }
    function go(d) {
      if (!S.tut) return;
      const next = S.tut.step + d;
      if (next < 0) return;
      if (next >= TUTORIAL.length) { closeTutorial(true); return; }
      S.tut.step = next;
      paintTutorial();
    }
    function paintTutorial() {
      const t = S.tut, st = TUTORIAL[t.step];
      const cv = document.createElement('canvas');
      cv.width = 216; cv.height = 216;
      cv.style.cssText = 'width:108px;height:108px;align-self:center';
      cv.setAttribute('aria-hidden', 'true');
      drawMini(cv, st.show);
      const last = t.step === TUTORIAL.length - 1;
      const btn = (label, fn, primary = false, k = '') => h(`button.arc-ov__btn${primary ? '.is-primary' : ''}`, { type: 'button', dataset: { act: k }, onclick: fn }, h('span', { text: label }));
      const next = btn(last ? 'Start playing' : 'Next', () => go(1), true, 'next');
      t.box.replaceChildren(
        h('h3', { id: 'arx-ttt-tut', text: st.title }),
        cv,
        h('p.arc-ov__text', { text: st.text }),
        h('small.arx-bg__note', { text: `Step ${t.step + 1} of ${TUTORIAL.length}`, dataset: { k: 'step' } }),
        h('div.arc-ov__row',
          t.step > 0 ? btn('Back', () => go(-1), false, 'back') : null,
          last ? null : btn('Skip', () => closeTutorial(true), false, 'skip'),
          next));
      setTimeout(() => { if (S.tut === t) next.focus({ preventScroll: true }); }, 30);
    }
    /* a little 9 × 9 picture for each step */
    function drawMini(cv, show) {
      const g = cv.getContext('2d'), z = cv.width, c = z / 9, B = z / 3, lk = LK();
      g.fillStyle = lk.bg; g.fillRect(0, 0, z, z);
      const box = (s, fill) => { g.fillStyle = fill; g.fillRect((s % 3) * B, Math.floor(s / 3) * B, B, B); };
      const outline = (s, color) => { g.strokeStyle = color; g.lineWidth = 6; g.strokeRect((s % 3) * B + 3, Math.floor(s / 3) * B + 3, B - 6, B - 6); };
      const markAt = (i, v, big = false) => {
        const x = big ? ((i % 3) + 0.5) * B : ((i % 9) + 0.5) * c, y = big ? (Math.floor(i / 3) + 0.5) * B : (Math.floor(i / 9) + 0.5) * c, r = (big ? B : c) * 0.3;
        g.strokeStyle = v === 1 ? lk.you : lk.them; g.lineWidth = big ? 7 : 4; g.lineCap = 'round';
        g.beginPath();
        if (v === 1) { g.moveTo(x - r, y - r); g.lineTo(x + r, y + r); g.moveTo(x + r, y - r); g.lineTo(x - r, y + r); } else g.arc(x, y, r, 0, Math.PI * 2);
        g.stroke();
      };
      if (show === 'won') { box(4, lk.live); markAt(4, 1, true); markAt(0, -1, true); }
      if (show === 'send') { box(2, lk.live); outline(2, lk.them); markAt(T.cellOf(4, 2), 1); }
      if (show === 'free') { markAt(2, 1, true); for (const s of [0, 1, 3, 4, 5, 6, 7, 8]) box(s, lk.live); markAt(T.cellOf(4, 2), 1); }
      if (show === 'outline') { box(6, lk.live); outline(6, lk.you); }
      for (let i = 1; i < 9; i++) {
        const big = i % 3 === 0;
        g.strokeStyle = big ? lk.big : lk.small; g.lineWidth = big ? 4 : 1.5;
        g.beginPath(); g.moveTo(i * c, 0); g.lineTo(i * c, z); g.moveTo(0, i * c); g.lineTo(z, i * c); g.stroke();
      }
    }
    function closeTutorial(seen) {
      if (!S.tut) return;
      S.tut.el.remove();
      S.tut = null;
      if (seen) writePrefs({ ultSeen: true });
      paint();
      refocus();
      if (S.cpuWaits) { S.cpuWaits = false; cpuTurn(); }
    }

    /* ------------------------------ text ------------------------------ */
    function rulesText() {
      if (!S.ult) return 'Classic: take turns putting your mark in an empty square; X goes first. Three in a row across, down or diagonally wins; a full board with no line is a draw.' + (mode === 'online' ? ' Online games are always classic.' : '');
      return 'Ultimate: nine small boards make one big board. The square you take inside a small board sends your opponent to the small board in the same place; if that board is already won or full, they may play in any open board. '
        + 'Three in a row inside a small board takes it; three small boards in a row wins. A small board that fills up with no line counts for nobody.';
    }
    function overText() {
      const o = S.over;
      if (!o) return '';
      if (o.winner === 0) return 'A draw.';
      if (mode === '2p') return `${nameOf(o.winner)} wins!`;
      if (o.reason === 'resign') return o.who === 'me' ? 'You resigned.' : `${peerName} resigned — you win.`;
      return o.winner === me ? 'Three in a row — you win!' : `${mode === 'cpu' ? 'The computer' : peerName} wins.`;
    }
    function say(t) { sr.textContent = t; }
    const statusText = () => {
      const g = S.g;
      if (S.over) return overText();
      const where = S.ult ? (g.next === -1 ? ' — play in any open board' : ` — play in the ${BOARD_NAMES[g.next]} board (outlined)`) : '';
      if (mode === 'cpu') return g.turn === me ? `${S.hinting ? 'Finding a hint… ' : ''}Your move (${name(g.turn)})${where}` : 'The computer is thinking…';
      if (mode === '2p') return `${nameOf(g.turn)} to move${where}`;
      return g.turn === me ? `Your move (${name(g.turn)})` : `${peerName}’s move`;
    };

    function paint() {
      if (dead) return;
      const g = S.g;
      const text = statusText();
      statusEl.textContent = text;
      statusEl.classList.remove('is-alert');
      statusEl.classList.toggle('is-done', !!S.over);
      const topV = mode === '2p' ? -1 : -me, botV = mode === '2p' ? 1 : me;
      const order = v => (v === 1 ? 'goes first' : 'goes second');
      topStrip.set({ name: mode === '2p' ? 'Player O' : mode === 'cpu' ? 'Computer' : peerName, note: `${name(topV)} · ${mode === 'cpu' ? `${T.LEVELS[S.level].name} · ` : ''}${order(topV)}`,
        color: colorOf(topV), turn: !S.over && g.turn === topV, thinking: S.thinking });
      botStrip.set({ name: mode === '2p' ? 'Player X' : 'You', note: `${name(botV)} · ${order(botV)}`, color: colorOf(botV), turn: !S.over && g.turn === botV });
      if (undoBtn) undoBtn.disabled = !!S.over || (mode === '2p' ? !g.moves.length : !S.by.includes('me'));
      if (resignBtn) { resignBtn.disabled = !!S.over; if (S.over) resignBtn.reset(); }
      if (hintBtn) hintBtn.disabled = !canAct() || S.hinting;
      if (howBtn) howBtn.hidden = !S.ult;
      if (!S.ended) recLine?.set(records.vsOf('ttt', recKey(S.level)), recLabel(S.level));
      sf.cv.setAttribute('aria-label', `${S.ult ? 'Ultimate ' : ''}Tic-Tac-Toe board. ${text}`);
      ctx.onScore(mode === '2p' ? g.moves.length : S.myMoves);
      if (NET) NET.peerScore?.(S.by.filter(b => b === 'peer').length);
      draw();
    }

    /* ------------------------------ drawing ------------------------------ */
    const N = () => (S.ult ? 9 : 3);
    /* with Coordinates on, the letters sit above the board and the numbers to its left */
    function layout() {
      const pad = S.look.coords ? 0.07 : 0;
      const size = Math.max(60, Math.floor(Math.min(sf.w, sf.h) * 0.94 / (1 + pad)));
      return { size, x: Math.round((sf.w - size * (1 + pad)) / 2 + size * pad), y: Math.round((sf.h - size * (1 + pad)) / 2 + size * pad) };
    }
    const cellAt = (x, y) => {
      const L = S.geo, n = N(), c = Math.floor(((x - L.x) / L.size) * n), r = Math.floor(((y - L.y) / L.size) * n);
      return c >= 0 && c < n && r >= 0 && r < n ? r * n + c : -1;
    };
    function mark(g, v, x, y, r, color, alpha = 1, k = 1) {
      g.save();
      g.globalAlpha = alpha;
      g.strokeStyle = color;
      g.lineWidth = Math.max(2, r * 0.28);
      g.lineCap = 'round';
      if (LK().neon) { g.shadowColor = color; g.shadowBlur = r * 0.5; }
      g.beginPath();
      if (v === 1) {
        const a = r * 0.8;
        g.moveTo(x - a, y - a); g.lineTo(x - a + 2 * a * Math.min(1, k * 2), y - a + 2 * a * Math.min(1, k * 2));
        if (k > 0.5) { g.moveTo(x + a, y - a); g.lineTo(x + a - 2 * a * Math.min(1, (k - 0.5) * 2), y - a + 2 * a * Math.min(1, (k - 0.5) * 2)); }
      } else g.arc(x, y, r * 0.8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, k));
      g.stroke();
      g.restore();
    }
    function draw() {
      if (dead) return;
      const g = sf.g;
      sf.begin();
      const L = S.geo = layout();
      const lk = LK();
      const n = N(), cell = L.size / n, now = performance.now(), B = L.size / 3;
      g.fillStyle = lk.bg;
      g.fillRect(0, 0, sf.w, sf.h);
      if (lk.glow) {
        const glow = g.createRadialGradient(sf.w / 2, sf.h / 2, 0, sf.w / 2, sf.h / 2, Math.max(sf.w, sf.h) * 0.6);
        glow.addColorStop(0, lk.glow);
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = glow; g.fillRect(0, 0, sf.w, sf.h);
      }
      /* the small board to play in (Ultimate): lit, and outlined in the mover's colour when it is forced */
      if (S.ult && !S.over) {
        const forced = S.g.next !== -1;
        const live = forced ? [S.g.next] : [0, 1, 2, 3, 4, 5, 6, 7, 8].filter(s => S.g.sub[s] === 0);
        const act = canAct() || S.thinking;
        g.fillStyle = act ? lk.live : lk.idle;
        for (const s of live) g.fillRect(L.x + (s % 3) * B, L.y + Math.floor(s / 3) * B, B, B);
        if (forced) {
          const s = S.g.next;
          g.save();
          g.strokeStyle = colorOf(S.g.turn);
          g.globalAlpha = act ? 1 : 0.6;
          g.lineWidth = Math.max(3, L.size * 0.012);
          if (lk.neon) { g.shadowColor = colorOf(S.g.turn); g.shadowBlur = 12; }
          g.strokeRect(L.x + (s % 3) * B + 3, L.y + Math.floor(s / 3) * B + 3, B - 6, B - 6);
          g.restore();
        }
      }
      /* hover / cursor ghost */
      const hv = S.kb ? S.cursor : S.hover;
      if (hv >= 0 && canAct()) {
        const r = Math.floor(hv / n), c = hv % n;
        const okc = T.canPlay(S.g, hv);
        if (okc) mark(g, S.g.turn, L.x + (c + 0.5) * cell, L.y + (r + 0.5) * cell, cell * 0.3, colorOf(S.g.turn), 0.35);
        if (S.kb) { g.strokeStyle = lk.mark; g.globalAlpha = 0.7; g.lineWidth = 2; g.setLineDash([4, 4]); g.strokeRect(L.x + c * cell + 3, L.y + r * cell + 3, cell - 6, cell - 6); g.setLineDash([]); g.globalAlpha = 1; }
      }
      /* the hint: a ghost mark and a dashed ring */
      if (S.hint !== null && !S.over) {
        const r = Math.floor(S.hint / n), c = S.hint % n, x = L.x + (c + 0.5) * cell, y = L.y + (r + 0.5) * cell;
        mark(g, S.g.turn, x, y, cell * 0.3, colorOf(S.g.turn), 0.5);
        g.save();
        g.strokeStyle = lk.mark; g.lineWidth = Math.max(2, cell * 0.05);
        g.setLineDash([cell * 0.09, cell * 0.07]);
        g.beginPath(); g.arc(x, y, cell * 0.42, 0, Math.PI * 2); g.stroke();
        g.restore();
      }
      /* grid */
      g.lineCap = 'round';
      for (let i = 1; i < n; i++) {
        const big = !S.ult || i % 3 === 0;
        g.strokeStyle = big ? lk.big : lk.small;
        g.lineWidth = big ? Math.max(2, L.size * (lk.thick ? 0.016 : 0.012)) : (lk.thick ? 1.5 : 1);
        g.beginPath(); g.moveTo(L.x + i * cell, L.y); g.lineTo(L.x + i * cell, L.y + L.size); g.stroke();
        g.beginPath(); g.moveTo(L.x, L.y + i * cell); g.lineTo(L.x + L.size, L.y + i * cell); g.stroke();
      }
      /* marks */
      let sx = 0;
      if (S.shake && now - S.shake < 200) sx = Math.sin((now - S.shake) / 18) * 4 * (1 - (now - S.shake) / 200);
      const win = S.over?.line;
      for (let i = 0; i < n * n; i++) {
        const v = S.g.cells[i];
        if (!v) continue;
        const r = Math.floor(i / n), c = i % n;
        const t0 = S.placed.get(i);
        const k = reduced || t0 === undefined ? 1 : Math.min(1, (now - t0) / 220);
        const dim = S.ult && S.g.sub[T.subOf(i)] !== 0 && S.g.sub[T.subOf(i)] !== v ? 0.25 : S.ult && S.g.sub[T.subOf(i)] !== 0 ? 0.55 : 1;
        mark(g, v, L.x + (c + 0.5) * cell + sx, L.y + (r + 0.5) * cell, cell * 0.3, colorOf(v), dim, k);
      }
      /* Ultimate: decided small boards wear a big mark */
      if (S.ult) {
        for (let s = 0; s < 9; s++) {
          const v = S.g.sub[s];
          const cx = L.x + ((s % 3) + 0.5) * B, cy = L.y + (Math.floor(s / 3) + 0.5) * B;
          if (v === 1 || v === -1) mark(g, v, cx, cy, B * 0.34, colorOf(v), 0.95);
          else if (v === 2) { g.fillStyle = lk.full; g.fillRect(cx - B / 2 + 2, cy - B / 2 + 2, B - 4, B - 4); }
        }
      }
      /* the winning line */
      if (win) {
        const pulse = reduced ? 1 : 0.65 + 0.35 * Math.sin(now / 160);
        g.save();
        g.strokeStyle = lk.mark;
        g.globalAlpha = pulse;
        g.shadowColor = lk.mark; g.shadowBlur = 16;
        g.lineWidth = Math.max(3, L.size * 0.016);
        const pt = k => S.ult
          ? [L.x + ((k % 3) + 0.5) * B, L.y + (Math.floor(k / 3) + 0.5) * B]
          : [L.x + ((k % 3) + 0.5) * cell, L.y + (Math.floor(k / 3) + 0.5) * cell];
        const a = pt(win[0]), b = pt(win[2]);
        g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
        g.restore();
      }
      /* coordinates: a–c / a–i along the top, 1–3 / 1–9 down the left */
      if (S.look.coords) {
        g.fillStyle = lk.ink;
        g.font = `700 ${Math.max(9, Math.round(Math.min(cell * 0.3, L.size * 0.045)))}px Inter,system-ui,sans-serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        for (let c = 0; c < n; c++) g.fillText('abcdefghi'[c], L.x + (c + 0.5) * cell, L.y - L.size * 0.035);
        for (let r = 0; r < n; r++) g.fillText(String(r + 1), L.x - L.size * 0.035, L.y + (r + 0.5) * cell);
      }
    }

    /* ------------------------------ input ------------------------------ */
    const at = e => { const r = sf.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const onDown = e => {
      if (e.button > 0 || dead) return;
      snd.wake();
      S.kb = false;
      const p = at(e), i = cellAt(p.x, p.y);
      if (i < 0) return;
      S.hover = i;
      tryPlace(i);
    };
    const onMove = e => {
      const p = at(e), i = cellAt(p.x, p.y);
      S.kb = false;
      if (i !== S.hover) { S.hover = i; sf.cv.style.cursor = i >= 0 && canAct() && T.canPlay(S.g, i) ? 'pointer' : 'default'; draw(); }
    };
    const onLeave = () => { if (S.hover !== -1) { S.hover = -1; draw(); } };
    const onKey = e => {
      if (!ownsKey(el, e) || dead || S.ended || S.tut || opts.isOpen()) return;
      const k = e.key, n = N();
      const dir = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[k];
      if (dir) {
        e.preventDefault(); snd.wake();
        S.kb = true;
        const r = Math.max(0, Math.min(n - 1, Math.floor(S.cursor / n) + dir[0])), c = Math.max(0, Math.min(n - 1, (S.cursor % n) + dir[1]));
        S.cursor = r * n + c;
        draw();
        return;
      }
      if (k === 'Enter' || k === ' ') { e.preventDefault(); snd.wake(); S.kb = true; tryPlace(S.cursor); return; }
      if (/^[1-9]$/.test(k) && !S.ult) { e.preventDefault(); snd.wake(); S.cursor = Number(k) - 1; S.kb = true; tryPlace(S.cursor); return; }
      if ((k === 'h' || k === 'H') && hintBtn) { e.preventDefault(); hint(); return; }
      if ((k === 'u' || k === 'U' || k === 'z' || k === 'Z' || k === 'Backspace') && mode !== 'online') { e.preventDefault(); undo(); }
    };
    window.addEventListener('keydown', onKey);
    sf.cv.addEventListener('pointerdown', onDown);
    sf.cv.addEventListener('pointermove', onMove);
    sf.cv.addEventListener('pointerleave', onLeave);

    if (S.ult && !prefs.ultSeen) openTutorial(0);
    newGame();

    const rows = () => {
      const n = N(), out = [];
      for (let r = 0; r < n; r++) { let s = ''; for (let c = 0; c < n; c++) { const v = S.g.cells[r * n + c]; s += v === 1 ? 'X' : v === -1 ? 'O' : '.'; } out.push(s); }
      return out;
    };
    const id = v => (v === 1 ? 1 : v === -1 ? 2 : 0);
    return {
      stop() {
        dead = true;
        clearTimeout(S.endT);
        brain?.close();
        link?.stop();
        loop.stop();
        opts.close();
        if (S.tut) { S.tut.el.remove(); S.tut = null; }
        window.removeEventListener('keydown', onKey);
        sf.cv.removeEventListener('pointerdown', onDown);
        sf.cv.removeEventListener('pointermove', onMove);
        sf.cv.removeEventListener('pointerleave', onLeave);
        resignBtn?.reset();
        snd.close();
        sf.destroy();
        root.remove();
      },
      /* what a watcher is allowed to see (js/arcade/spectate.js): small, no names but the strip's */
      spectate: () => ({
        k: 'board', st: S.ult ? 'uttt' : 'ttt', w: N(), h: N(), cells: rows().join(''),
        hl: S.over?.line ? S.over.line.slice() : [], txt: statusEl.textContent, over: !!S.over,
        x: S.ult ? { sub: Array.from(S.g.sub, v => (v === 1 ? 'X' : v === -1 ? 'O' : v === 2 ? '=' : '.')).join(''), nx: S.g.next } : null,
        pl: [{ n: mode === '2p' ? 'Player X' : (me === 1 ? 'You' : (mode === 'cpu' ? 'Computer' : peerName)), m: 'X' }, { n: mode === '2p' ? 'Player O' : (me === 1 ? (mode === 'cpu' ? 'Computer' : peerName) : 'You'), m: 'O' }],
        turn: S.over ? 0 : S.g.turn,
      }),
      peek: () => ({
        mode, me: mode === '2p' ? null : id(me), turn: id(S.g.turn), ult: S.ult, grid: rows(), moves: S.g.moves.join(','), sub: Array.from(S.g.sub).join(''), next: S.g.next,
        over: S.over ? { winner: id(S.over.winner), reason: S.over.reason || 'line', line: S.over.line || null } : null,
        level: S.level, lowest: S.lowest, first: S.first, thinking: S.thinking, worker: !!brain?.worker, rejected: S.rejected, myMoves: S.myMoves, ended: S.ended,
        cursor: S.cursor, geo: { ...S.geo }, status: statusEl.textContent,
        hint: S.hint, hints: S.hints, hinting: S.hinting, look: { ...S.look }, theme: LK(), said: sr.textContent,
        tutorial: S.tut ? { step: S.tut.step, of: TUTORIAL.length, title: TUTORIAL[S.tut.step].title } : null, ultSeen: readPrefs().ultSeen,
        forced: S.ult && !S.over && S.g.next !== -1 ? BOARD_NAMES[S.g.next] : null,
        record: { key: recKey(S.level), label: recLabel(S.level) },
      }),
    };
  },
};
