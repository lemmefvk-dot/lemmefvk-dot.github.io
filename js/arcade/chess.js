/* ============================================================
   arcade/chess.js — Chess for Static Arcade.

   Three ways to play, picked in the Arcade's HUD:
   · 1P: against the computer — Easy, Medium or Hard, as White or
     Black (both remembered in portal.arcadeChess). Its search runs in
     a Web Worker (./thinker.js → ./think.js) so the page never
     freezes; Undo takes back your last move and its reply.
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

   Score: in 1P, a win scores the number of moves it took (fewer is
   better); a loss or a draw scores nothing. 2P and online games
   never change a best. The board is a canvas, so Static Replay can
   record it.
   ============================================================ */
import { h } from '../core/dom.js';
import { store } from '../core/store.js';
import {
  Position, WHITE, BLACK, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, F_PROMO, F_CAPTURE, F_CASTLE,
  mFrom, mTo, mPromo, mFlags, sqName, uci, LEVELS,
} from './chess-rules.js';
import { thinker } from './thinker.js';
import { KIT_CSS, surface, ownsKey, sounder, looper, rr, playerStrip, segment, button, confirmButton, duelLink } from './boardkit.js';

const PREF = 'portal.arcadeChess';
const LIGHT = '#d6e4da', DARK = '#4f8a78';
const W_FILL = ['#ffffff', '#d8d3ca'], W_INK = '#18151d';
const B_FILL = ['#4a4252', '#141118'], B_INK = '#050407', B_DETAIL = '#d9d0e6';
const MIN_THINK_MS = 350;
const NAMES = { [PAWN]: 'pawn', [KNIGHT]: 'knight', [BISHOP]: 'bishop', [ROOK]: 'rook', [QUEEN]: 'queen', [KING]: 'king' };
const VALUE = [0, 1, 3, 3, 5, 9, 0];
const REASON = {
  checkmate: 'checkmate', stalemate: 'stalemate', threefold: 'threefold repetition', fifty: 'the 50-move rule',
  material: 'too little material to mate', resign: 'resignation',
};
const ARROWS = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
const colorName = c => (c === WHITE ? 'White' : 'Black');

const readPrefs = () => {
  let p = null;
  try { p = store.get(PREF, null); } catch (err) { p = null; }
  return { level: [1, 2, 3].includes(p?.level) ? p.level : 2, side: p?.side === 'b' ? 'b' : 'w' };
};
const writePrefs = patch => { try { store.set(PREF, { ...readPrefs(), ...patch }); } catch (err) { /* a convenience */ } };

export default {
  mount(el, ctx) {
    const NET = ctx.online && typeof ctx.online.send === 'function' ? ctx.online : null;
    const mode = NET ? 'online' : ctx.players === 2 ? '2p' : 'cpu';
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    const brain = mode === 'cpu' ? thinker() : null;
    const prefs = readPrefs();
    const host = NET?.role === 'host';
    const round = Number.isInteger(NET?.round) ? NET.round : 1;
    const peerName = String(NET?.peer?.name || 'Friend');
    let me = mode === 'online' ? ((round % 2 === 1) === host ? WHITE : BLACK) : mode === 'cpu' ? (prefs.side === 'b' ? BLACK : WHITE) : WHITE;
    let flipped = mode !== '2p' && me === BLACK;
    let dead = false;

    const S = {
      pos: new Position(), keys: [], hist: [], last: null,
      sel: -1, targets: [], cursor: 0, kb: false, hover: -1,
      drag: null, anims: [], over: null, ended: false, endT: 0,
      thinking: false, thinkId: 0, promo: null,
      level: prefs.level, myMoves: 0, rejected: 0, geo: { x: 0, y: 0, sq: 0 },
    };
    const them = () => -me;

    /* ------------------------------ the page ------------------------------ */
    const boardEl = h('div.arx-bg__board');
    const sr = h('div.arx-bg__sr', { 'aria-live': 'polite' });
    const statusEl = h('div.arx-bg__status', { role: 'status' });
    const topStrip = playerStrip('#888', '', '');
    const botStrip = playerStrip('#fff', '', '');
    const movesEl = h('ol.arx-bg__moves', { 'aria-label': 'Moves', dataset: { empty: 'No moves yet' } });
    const levelSeg = mode === 'cpu' ? segment('Level', [1, 2, 3].map(id => ({ id, label: LEVELS[id].name })), S.level, setLevel) : null;
    const sideSeg = mode === 'cpu' ? segment('Play as', [{ id: 'w', label: 'White' }, { id: 'b', label: 'Black', title: 'The computer moves first' }], prefs.side, setSide) : null;
    const undoBtn = mode !== 'online' ? button('Undo', 'corner-up-left', () => { undo(); refocus(); }, { title: mode === 'cpu' ? 'Take back your last move and the computer’s reply (U)' : 'Take back the last move (U)' }) : null;
    const resignBtn = mode !== '2p' ? confirmButton('Resign', 'Resign? Click again', 'x', () => { resign(); refocus(); }) : null;
    const note = mode === 'online'
      ? h('div.arx-bg__note', { text: 'Every move is checked against the rules on both screens. No clock — take your time.' })
      : mode === '2p' ? h('div.arx-bg__note', { text: 'Two players on this screen: take turns. White is at the bottom.' }) : null;
    const side = h('div.arx-bg__side',
      topStrip.el, statusEl, levelSeg?.el, sideSeg?.el, movesEl,
      h('div.arx-bg__row', undoBtn, resignBtn), note, botStrip.el);
    const root = h('div.arx-bgc', { style: { '--ga': ctx.accent || 'var(--accent)' } }, h('style', { text: KIT_CSS }), h('div.arx-bg', boardEl, side), sr);
    el.appendChild(root);
    const sf = surface(boardEl, 'Chess board', () => draw());
    const loop = looper(() => draw());
    const refocus = () => el.closest('[tabindex]')?.focus({ preventScroll: true });

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
        paint();
        finishSoon();
      },
      dead: () => dead,
    }) : null;

    /* ------------------------------ rules glue ------------------------------ */
    function newGame() {
      if (brain) brain.cancel();
      clearTimeout(S.endT);
      S.pos = new Position();
      S.keys = [S.pos.key()];
      S.hist = []; S.last = null; S.sel = -1; S.targets = []; S.anims = []; S.over = null; S.ended = false;
      S.thinking = false; S.thinkId++; S.myMoves = 0; S.drag = null;
      closePromo();
      flipped = mode !== '2p' && me === BLACK;
      S.cursor = mode === '2p' || me === WHITE ? 0x14 : 0x64;          /* e2 / e7 */
      ctx.onScore(0);
      NET?.peerScore?.(0);
      paint();
      if (mode === 'cpu' && S.pos.turn !== me) computerMove();
    }

    const canAct = () => !dead && !S.over && !S.promo && !S.thinking && (mode === '2p' || S.pos.turn === me);
    const moverColor = () => (mode === '2p' ? S.pos.turn : me);
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
      pos.make(m);
      S.keys.push(pos.key());
      S.hist.push({ m, san, uci: uci(m), by, color: mover });
      S.last = { from, to };
      S.sel = -1; S.targets = [];
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
      if (o.over) S.over = o;
      if (pos.inCheck()) snd.blip(660, 0.12, 'triangle', 0.9, 990);
      else if (flags & F_CAPTURE) snd.blip(220, 0.09, 'square', 0.6, 140);
      else snd.blip(420, 0.05, 'triangle', 0.6);
      const who = mode === '2p' ? colorName(mover) : by === 'me' ? 'You' : mode === 'cpu' ? 'The computer' : peerName;
      say(`${who} played ${spoken(san)}.${o.over ? ' ' + overText() : pos.inCheck() ? ' Check.' : ''}`);
      paint();
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
      if (dead || id !== S.thinkId) return;
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
      if (mode === 'online' || S.over || S.promo || dead) return;
      if (mode === '2p') {
        if (!S.hist.length) return;
        takeBack();
      } else {
        let mine = -1;
        for (let i = S.hist.length - 1; i >= 0; i--) if (S.hist[i].by === 'me') { mine = i; break; }
        if (mine < 0) return;
        if (S.thinking) { brain.cancel(); S.thinkId++; S.thinking = false; }
        while (S.hist.length > mine) takeBack();
      }
      const lastMove = S.hist[S.hist.length - 1];
      S.last = lastMove ? { from: mFrom(lastMove.m), to: mTo(lastMove.m) } : null;
      S.sel = -1; S.targets = []; S.anims = [];
      snd.blip(330, 0.07, 'triangle', 0.6, 220);
      say('Move taken back.');
      paint();
    }

    function resign() {
      if (S.over || dead) return;
      if (S.thinking) { brain?.cancel(); S.thinkId++; S.thinking = false; }
      closePromo();
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
      if (S.ended || dead || !S.over) return;
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
      if (mode === '2p') {
        ctx.onEnd({ score: null, detail: o.winner === 0 ? `Draw by ${how}.` : `${colorName(o.winner)} wins by ${how}, after ${moves} moves.` });
        return;
      }
      const lv = LEVELS[S.level].name;
      if (o.winner === me) ctx.onEnd({ score: S.myMoves, won: true, detail: `Checkmate in ${S.myMoves} moves against the computer (${lv}).` });
      else if (o.winner === 0) ctx.onEnd({ score: null, won: false, detail: `Draw by ${how} against the computer (${lv}).` });
      else ctx.onEnd({ score: null, won: false, detail: o.reason === 'resign' ? `You resigned against the computer (${lv}).` : `Checkmate — the computer (${lv}) wins.` });
    }

    function setLevel(v) {
      S.level = v;
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
      if (o.winner === me) return o.reason === 'resign' ? `${mode === 'cpu' ? 'The computer' : peerName} resigned — you win.` : `Checkmate — you win!`;
      return o.reason === 'resign' ? 'You resigned.' : `Checkmate — ${mode === 'cpu' ? 'the computer' : peerName} wins.`;
    }
    function say(t) { sr.textContent = t; }

    /* ------------------------------ panel ------------------------------ */
    function material() {
      let d = 0;
      for (let sq = 0; sq < 128; sq++) { if (sq & 0x88) { sq += 7; continue; } const p = S.pos.b[sq]; if (p) d += Math.sign(p) * VALUE[Math.abs(p)]; }
      return d;      /* + = White ahead */
    }
    function paint() {
      if (dead) return;
      const pos = S.pos;
      const check = pos.inCheck();
      let text;
      if (S.over) text = overText();
      else if (mode === 'cpu') text = pos.turn === me ? (check ? 'Check! Your move' : 'Your move') : 'The computer is thinking…';
      else if (mode === '2p') text = `${colorName(pos.turn)} to move${check ? ' — check!' : ''}`;
      else text = pos.turn === me ? (check ? 'Check! Your move' : 'Your move') : `${peerName}’s move${check ? ' — check' : ''}`;
      if (S.promo) text = 'Pick what the pawn becomes';
      statusEl.textContent = text;
      statusEl.classList.toggle('is-alert', !S.over && check);
      statusEl.classList.toggle('is-done', !!S.over);

      const mat = material();
      const plus = c => { const v = mat * c; return v > 0 ? ` · +${v}` : ''; };
      const topColor = mode === '2p' ? BLACK : them(), botColor = mode === '2p' ? WHITE : me;
      const sw = c => (c === WHITE ? '#f4f1ea' : '#2a2430');
      const topName = mode === '2p' ? 'Black' : mode === 'cpu' ? 'Computer' : peerName;
      const topNote = mode === 'cpu' ? `${LEVELS[S.level].name} · ${colorName(topColor)}${plus(topColor)}` : `${colorName(topColor)}${plus(topColor)}`;
      topStrip.set({ name: topName, note: topNote, color: sw(topColor), turn: !S.over && pos.turn === topColor, thinking: S.thinking });
      botStrip.set({ name: mode === '2p' ? 'White' : 'You', note: `${colorName(botColor)}${plus(botColor)}`, color: sw(botColor), turn: !S.over && pos.turn === botColor, thinking: false });

      const rows = [];
      for (let i = 0; i < S.hist.length; i += 2) {
        const last = S.hist.length - 1;
        rows.push(h('li', h('span', { text: `${i / 2 + 1}.` }),
          h('span', { class: i === last ? 'is-last' : '', text: S.hist[i].san }),
          h('span', { class: i + 1 === last ? 'is-last' : '', text: S.hist[i + 1]?.san || '' })));
      }
      movesEl.replaceChildren(...rows);
      movesEl.scrollTop = movesEl.scrollHeight;
      if (undoBtn) undoBtn.disabled = !!S.over || !S.hist.some(x => mode === '2p' || x.by === 'me');
      if (resignBtn) { resignBtn.disabled = !!S.over; if (S.over) resignBtn.reset(); }
      levelSeg?.set(S.level);
      sf.cv.setAttribute('aria-label', `Chess board. ${text}. ${S.hist.length ? `Last move ${S.hist[S.hist.length - 1].san}.` : ''}`);
      const live = mode === 'cpu' ? S.myMoves : mode === '2p' ? Math.ceil(S.hist.length / 2) : S.hist.filter(x => x.by === 'me').length;
      ctx.onScore(live);
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
      const L = S.geo = layout();
      g.fillStyle = '#07080b';
      g.fillRect(0, 0, sf.w, sf.h);
      const glow = g.createRadialGradient(sf.w / 2, sf.h / 2, 0, sf.w / 2, sf.h / 2, Math.max(sf.w, sf.h) * 0.6);
      glow.addColorStop(0, 'hsla(165,80%,40%,.16)');
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = glow;
      g.fillRect(0, 0, sf.w, sf.h);
      g.save();
      g.shadowBlur = 28;
      g.shadowColor = 'hsla(165,90%,45%,.35)';
      g.fillStyle = '#0e1412';
      rr(g, L.x - 6, L.y - 6, L.sq * 8 + 12, L.sq * 8 + 12, 10);
      g.fill();
      g.restore();
      const pos = S.pos, now = performance.now();
      const legalTo = new Set(S.targets.map(mTo));
      const hoverSq = S.drag?.moved ? squareAt(S.drag.x, S.drag.y) : S.hover;
      for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
        const sq = r * 16 + f, { col, row } = cellOf(sq);
        const x = L.x + col * L.sq, y = L.y + row * L.sq;
        g.fillStyle = (r + f) % 2 ? LIGHT : DARK;
        g.fillRect(x, y, L.sq, L.sq);
        if (S.last && (sq === S.last.from || sq === S.last.to)) { g.fillStyle = 'rgba(255,214,80,.42)'; g.fillRect(x, y, L.sq, L.sq); }
        if (sq === S.sel) { g.fillStyle = 'rgba(80,220,255,.45)'; g.fillRect(x, y, L.sq, L.sq); }
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
      const fs = Math.max(8, Math.round(L.sq * 0.17));
      g.font = `700 ${fs}px Inter,ui-sans-serif,system-ui,sans-serif`;
      for (let i = 0; i < 8; i++) {
        /* each label in the other square colour, so it reads on its square */
        const fileSq = flipped ? 7 - i : i;
        g.textAlign = 'right'; g.textBaseline = 'bottom';
        const bottomRank = flipped ? 7 : 0;
        g.fillStyle = (bottomRank + fileSq) % 2 ? DARK : LIGHT;
        g.fillText('abcdefgh'[fileSq], L.x + (i + 1) * L.sq - 3, L.y + 8 * L.sq - 2);
        const rank = flipped ? i : 7 - i;
        const leftFile = flipped ? 7 : 0;
        g.fillStyle = (rank + leftFile) % 2 ? DARK : LIGHT;
        g.textAlign = 'left'; g.textBaseline = 'top';
        g.fillText(String(rank + 1), L.x + 3, L.y + i * L.sq + 2);
      }
      /* where the picked piece can go */
      for (const sq of legalTo) {
        const { col, row } = cellOf(sq);
        const cx = L.x + (col + 0.5) * L.sq, cy = L.y + (row + 0.5) * L.sq;
        g.fillStyle = 'rgba(10,30,40,.38)';
        g.strokeStyle = 'rgba(10,30,40,.42)';
        if (pos.piece(sq) || S.targets.some(m => mTo(m) === sq && (mFlags(m) & F_CAPTURE))) {
          g.lineWidth = L.sq * 0.08;
          g.beginPath(); g.arc(cx, cy, L.sq * 0.44, 0, Math.PI * 2); g.stroke();
        } else {
          g.beginPath(); g.arc(cx, cy, L.sq * 0.15, 0, Math.PI * 2); g.fill();
        }
      }
      /* pieces */
      const moving = new Map();
      S.anims = S.anims.filter(a => now - a.t0 < a.dur);
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
      if (S.drag?.moved) {
        const p = pos.b[S.drag.from];
        if (p) drawPiece(g, Math.abs(p), p > 0, S.drag.x - L.sq * 0.55, S.drag.y - L.sq * 0.6, L.sq * 1.1);
      }
      /* the keyboard cursor */
      if (S.kb && !S.over) {
        const { col, row } = cellOf(S.cursor);
        g.strokeStyle = '#ffffff';
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
      if (S.ended) return;
      const k = e.key;
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

    return {
      stop() {
        dead = true;
        clearTimeout(S.endT);
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
      /* a read-only snapshot for automated play-tests */
      /* what a watcher may see (./spectate.js): the position, whose move, the status line */
      spectate: () => ({
        k: 'board', st: 'chess', w: 8, h: 8,
        cells: S.pos.fen().split(' ')[0].split('/').map(r => r.replace(/[1-8]/g, d => '.'.repeat(Number(d)))).join(''),
        hl: [], txt: statusEl.textContent, over: !!S.over, x: null, turn: S.over ? 0 : S.pos.turn === WHITE ? 1 : -1,
        pl: [{ n: mode === '2p' ? 'White' : me === WHITE ? 'You' : (mode === 'cpu' ? 'Computer' : peerName), m: 'White' },
          { n: mode === '2p' ? 'Black' : me === BLACK ? 'You' : (mode === 'cpu' ? 'Computer' : peerName), m: 'Black' }],
      }),
      peek: () => ({
        mode, fen: S.pos.fen(), turn: S.pos.turn === WHITE ? 'w' : 'b', me: mode === '2p' ? null : me === WHITE ? 'w' : 'b',
        flipped, level: S.level, thinking: S.thinking, worker: !!brain?.worker,
        over: S.over ? { winner: S.over.winner === WHITE ? 'w' : S.over.winner === BLACK ? 'b' : null, reason: S.over.reason } : null,
        ended: S.ended, san: S.hist.map(x => x.san), uci: S.hist.map(x => x.uci), myMoves: S.myMoves,
        sel: S.sel >= 0 ? sqName(S.sel) : null, targets: S.targets.map(m => sqName(mTo(m))), cursor: sqName(S.cursor),
        promo: !!S.promo, rejected: S.rejected, check: S.pos.inCheck(), animating: S.anims.length > 0,
        geo: { ...S.geo }, status: statusEl.textContent,
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
