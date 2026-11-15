/* ============================================================
   arcade/reversi.js — Reversi (Othello rules) for Static Arcade.

   An 8 × 8 board, or 6 × 6 for a quicker game. Place a disc so that it
   brackets a straight line of the other colour's discs against one of
   yours: every bracketed disc flips. Black moves first. A player with no
   legal move passes (the game says so and does it); when neither can move,
   or the board is full, the side with more discs wins. The squares you may
   play are marked (a switch in the Board card; on unless you turn it off).

   · 1P: against the computer (Easy, Medium, Hard: alpha-beta search with
     corners and mobility in ./reversi-rules.js, run in a Web Worker so the
     page keeps drawing), you or the computer first, on 8 × 8 or 6 × 6;
     remembered in portal.arcadeReversi. Undo takes back your last move and
     the replies. A win scores your disc count (more is better). Your
     won–lost–drawn record is kept per size and level (records.js); a game
     counts at the easiest level the computer played in it.
   · 2P: Black and White take turns on one screen.
   · Online: a friend on another device through the Arcade's room, always
     on 8 × 8. The host is Black in odd rounds, White in even ones. Every
     arriving move is checked with the rules (whose turn, a legal square)
     before it reaches the board.
   · Hint (1P and 2P, never online): the computer's Hard move for the side
     to move, ringed on the board until the next move and said for a screen
     reader. Hints are counted; a 1P game with one sets no best. The Board
     card: four themes, coordinates (a–h across the top, 1–8 down the side,
     the names the game says moves with) and the legal-move marks.

   Mouse or touch: click or tap a marked square. Keyboard: arrows move the
   cursor, Enter / Space place, H hint, U / Z / Backspace undo. Flips turn
   over (a squash and swap); with reduced motion they are instant. Pause
   hides the board and stops the computer.
   ============================================================ */
import { h } from '../core/dom.js';
import { store } from '../core/store.js';
import * as R from './reversi-rules.js';
import * as records from './records.js';
import { thinker } from './thinker.js';
import { KIT_CSS, surface, ownsKey, sounder, looper, rr, playerStrip, segment, button, confirmButton, duelLink, boardOptions, recordLine, lookOf } from './boardkit.js';

const PREF = 'portal.arcadeReversi';
const MIN_THINK_MS = 420;
const FLIP_MS = 380;
const DARK = '#1c1d26', LIGHT = '#f4f1ea';
const LOOK = { coords: false, moves: true };
/* the board in each theme: arcade is the look Reversi always had */
const THEMES = {
  arcade: { bg: ['#1f8a58', '#136b43'], glow: 'rgba(40,200,120,.35)', line: 'rgba(0,0,0,.32)', lw: 1.5, star: 'rgba(0,0,0,.4)', ink: 'rgba(225,255,236,.85)', ring: false },
  wood: { bg: ['#cf9f5e', '#ac7c40'], glow: 'rgba(255,180,90,.25)', line: 'rgba(50,25,0,.5)', lw: 1.5, star: 'rgba(50,25,0,.55)', ink: 'rgba(255,240,215,.9)', ring: false },
  paper: { bg: ['#f3f0e7', '#e7e2d5'], glow: 'rgba(255,255,255,.08)', line: 'rgba(40,40,46,.55)', lw: 1.5, star: 'rgba(40,40,46,.6)', ink: 'rgba(40,40,46,.9)', ring: true },
  contrast: { bg: ['#767676', '#767676'], glow: 'rgba(0,0,0,0)', line: '#000000', lw: 2.5, star: '#000000', ink: '#ffffff', ring: true },
};
const SAMPLES = { arcade: ['#1f8a58', '#1c1d26'], wood: ['#cf9f5e', '#1c1d26'], paper: ['#f3f0e7', '#1c1d26'], contrast: ['#767676', '#ffffff'] };

const readPrefs = () => {
  let p = null;
  try { p = store.get(PREF, null); } catch (err) { p = null; }
  return { level: [1, 2, 3].includes(p?.level) ? p.level : 2, first: p?.first === 'cpu' ? 'cpu' : 'me', size: p?.size === 6 ? 6 : 8, ...lookOf(p, LOOK) };
};
const writePrefs = patch => { try { store.set(PREF, { ...readPrefs(), ...patch }); } catch (err) { /* a convenience */ } };
/* the cursor starts on a square Black may play */
const startCursor = n => (n === 6 ? 8 : 19);

export default {
  mount(el, ctx) {
    const NET = ctx.online && typeof ctx.online.send === 'function' ? ctx.online : null;
    const mode = NET ? 'online' : ctx.players === 2 ? '2p' : 'cpu';
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    /* 2P makes its thinker on the first hint */
    let brain = mode === 'cpu' ? thinker() : null;
    const prefs = readPrefs();
    const host = NET?.role === 'host';
    const round = Number.isInteger(NET?.round) ? NET.round : 1;
    const peerName = String(NET?.peer?.name || 'Friend');
    /* me is the value of my discs: 1 Black (first), -1 White */
    let me = mode === 'online' ? ((round % 2 === 1) === host ? 1 : -1) : mode === 'cpu' ? (prefs.first === 'cpu' ? -1 : 1) : 0;
    let dead = false;

    /* online is always 8 × 8 */
    const n0 = mode === 'online' ? 8 : prefs.size;
    const S = {
      n: n0, g: R.newGame(n0), by: [], over: null, anim: [], last: -1, hover: -1, cursor: startCursor(n0), kb: false, legal: [], note: '',
      thinking: false, thinkId: 0, level: prefs.level, vsLevel: prefs.level, first: prefs.first, rejected: 0, myMoves: 0, paused: false,
      ended: false, endT: 0, geo: { x: 0, y: 0, cell: 0, n: n0 }, shake: 0, hint: null, hints: 0, hintBusy: false, hintId: 0,
      look: { theme: prefs.theme, coords: prefs.coords, moves: prefs.moves },
    };
    const colorOf = v => (v === 1 ? DARK : LIGHT);
    const nameOf = v => (mode === '2p' ? (v === 1 ? 'Black' : 'White') : v === me ? 'You' : mode === 'cpu' ? 'The computer' : peerName);
    const sqName = i => R.squareName(i, S.n);

    /* ------------------------------ the page ------------------------------ */
    const boardEl = h('div.arx-bg__board');
    const sr = h('div.arx-bg__sr', { 'aria-live': 'polite' });
    const statusEl = h('div.arx-bg__status', { role: 'status' });
    const topStrip = playerStrip(LIGHT, '', '');
    const botStrip = playerStrip(DARK, '', '');
    const levelSeg = mode === 'cpu' ? segment('Level', [1, 2, 3].map(id => ({ id, label: R.LEVELS[id].name })), S.level, setLevel) : null;
    const recLine = mode === 'cpu' ? recordLine() : null;
    const firstSeg = mode === 'cpu' ? segment('First', [{ id: 'me', label: 'You' }, { id: 'cpu', label: 'Computer' }], S.first, setFirst) : null;
    const sizeSeg = mode !== 'online' ? segment('Size', [{ id: 8, label: '8×8', title: 'The standard board' }, { id: 6, label: '6×6', title: 'A smaller board, a quicker game' }], S.n, setSize) : null;
    const undoBtn = mode !== 'online' ? button('Undo', 'corner-up-left', () => { undo(); refocus(); }, { title: 'Take back the last move (U)' }) : null;
    const resignBtn = mode !== '2p' ? confirmButton('Resign', 'Resign? Click again', 'x', () => { resign(); refocus(); }) : null;
    const hintBtn = mode !== 'online' ? button('Hint', 'sparkles', () => { hint(); refocus(); }, { title: 'Ring the square the computer would play at Hard (H). Hints are counted, and a game with one sets no best.' }) : null;
    const board = boardOptions(boardEl, {
      samples: SAMPLES, coords: true,
      toggles: [{ id: 'moves', label: 'Show legal moves', note: 'A dot on every square you may play. Off: find them yourself; a square that flips nothing is refused.' }],
      get: () => ({ ...S.look }),
      set: (k, v) => { S.look[k] = k === 'theme' ? v : !!v; writePrefs({ [k]: S.look[k] }); paint(); },
      get rules() { return `Reversi on ${S.n}×${S.n}: a move must flip at least one disc, in any of the eight directions. A side with no legal move passes; when neither can move, more discs wins.`; },
      refocus: () => refocus(),
    });
    const note = h('div.arx-bg__note', {
      text: mode === 'online' ? 'Dots mark where you may play. Every move is checked on both screens. If a side has no move it passes.'
        : mode === '2p' ? 'Two players on this screen: Black goes first. A side with no legal move passes.'
          : 'Click a dotted square, or use the arrows and Enter. A side with no legal move passes.',
    });
    const side = h('div.arx-bg__side', topStrip.el, statusEl, levelSeg?.el, recLine?.el, firstSeg?.el, sizeSeg?.el,
      h('div.arx-bg__row', undoBtn, resignBtn), h('div.arx-bg__row', hintBtn, board.button), note, botStrip.el);
    const root = h('div.arx-bgc', h('style', { text: KIT_CSS }), h('div.arx-bg', boardEl, side), sr);
    el.appendChild(root);
    const sf = surface(boardEl, 'Reversi board', () => draw());
    const loop = looper(() => draw());
    const refocus = () => el.closest('[tabindex]')?.focus({ preventScroll: true });
    const say = t => { sr.textContent = t; };

    const link = NET ? duelLink(NET, {
      plies: () => S.g.moves.length,
      mine: i => S.by[i] === 'me',
      wire: i => ({ q: S.g.moves[i] }),
      take: d => {
        if (S.over || S.g.turn !== -me || !R.flipsAt(S.g.b, d.q, S.g.turn).length) return false;
        apply(d.q, 'peer');
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
    const humanTurn = () => mode === '2p' || S.g.turn === me;
    const canAct = () => !dead && !S.paused && !S.over && !S.thinking && humanTurn();
    const flipping = () => S.anim.some(a => performance.now() - a.t0 < a.dur + a.delay);
    const refreshLegal = () => { S.legal = S.over ? [] : R.legalMoves(S.g.b, S.g.turn); };
    /* a hint still being worked out is dropped when the board changes */
    const dropHint = () => {
      if (S.hintBusy) { brain?.cancel(); S.hintBusy = false; }
      S.hintId++;
      S.hint = null;
    };

    function newGame() {
      brain?.cancel();
      clearTimeout(S.endT);
      Object.assign(S, { g: R.newGame(S.n), by: [], over: null, anim: [], last: -1, thinking: false, myMoves: 0, ended: false, note: '', cursor: startCursor(S.n),
        hint: null, hints: 0, hintBusy: false, vsLevel: S.level });
      S.thinkId++; S.hintId++;
      refreshLegal();
      ctx.onScore(2);
      NET?.peerScore?.(2);
      paint();
      if (mode === 'cpu' && S.g.turn !== me) computerMove();
    }

    function tryPlace(i) {
      if (!canAct()) return false;
      if (!S.legal.includes(i)) {
        S.shake = performance.now();
        snd.blip(140, 0.08, 'sawtooth', 0.4);
        loop.kick(0.25);
        if (!S.look.moves && i >= 0 && !S.g.b[i]) say(`${sqName(i)} flips nothing.`);
        return false;
      }
      apply(i, 'me');
      link?.sendMove(S.g.moves.length - 1);
      return true;
    }

    function apply(i, by) {
      const g = S.g, n = S.n;
      const v = g.turn;
      dropHint();
      const r = R.play(g, i);
      S.by.push(by);
      if (by === 'me') S.myMoves++;
      S.last = i;
      const now = performance.now();
      S.anim = S.anim.filter(a => now - a.t0 < a.dur + a.delay);
      const ri = (i / n) | 0, ci = i % n;
      S.anim.push({ i, v, t0: now, dur: reduced ? 0 : 200, delay: 0, kind: 'drop' });
      r.flips.forEach(s => {
        const d = Math.max(Math.abs(((s / n) | 0) - ri), Math.abs((s % n) - ci));
        S.anim.push({ i: s, v, t0: now, dur: reduced ? 0 : FLIP_MS, delay: reduced ? 0 : 120 + d * 70, kind: 'flip' });
      });
      const settle = reduced ? 0 : 200 + 70 * (n - 1) + FLIP_MS;
      loop.kick(settle / 1000 + 0.1);
      snd.blip(340 + r.flips.length * 25, 0.06, 'triangle', 0.8);
      const o = R.outcome(g);
      S.note = r.passed && !o.over ? `${nameOf(r.passed)} ${r.passed === me && mode !== '2p' ? 'have' : 'has'} no legal move and pass${r.passed === me && mode !== '2p' ? '' : 'es'}.` : '';
      if (o.over) S.over = o;
      refreshLegal();
      const told = `${nameOf(v)} played ${sqName(i)} and flipped ${r.flips.length}. ${S.note} ${S.over ? overText() : ''}`;
      say(told);
      /* the other side's move, for a screen reader (the shell's live region): yours you just made */
      if (by !== 'me' || mode === '2p') ctx.announce?.(told);
      paint();
      if (S.over) finishSoon(settle);
      else if (mode === 'cpu' && g.turn !== me) computerMove(reduced ? 0 : Math.min(settle, 900));
    }

    async function computerMove(wait0 = 0) {
      if (S.paused) return;
      const id = ++S.thinkId;
      S.thinking = true;
      paint();
      const t0 = performance.now();
      const g = S.g;
      const res = await brain.ask({ game: 'reversi', b: Array.from(g.b), turn: g.turn, level: S.level });
      if (dead || id !== S.thinkId) return;
      const wait = Math.max(MIN_THINK_MS, wait0 + 80) - (performance.now() - t0);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      if (dead || id !== S.thinkId) return;
      S.thinking = false;
      if (!res || !R.flipsAt(S.g.b, res.sq, S.g.turn).length) {
        statusEl.textContent = 'The computer could not move. Press Undo or start again.';
        statusEl.classList.add('is-alert');
        return;
      }
      apply(res.sq, 'cpu');
    }

    /* the computer's Hard move for the side to move, ringed until the next move */
    async function hint() {
      if (mode === 'online' || !canAct() || S.hintBusy) return;
      if (!brain) brain = thinker();
      const id = ++S.hintId, at = S.g.moves.length, g = S.g;
      S.hintBusy = true;
      S.hint = null;
      say('Looking for a good move…');
      paint();
      const res = await brain.ask({ game: 'reversi', b: Array.from(g.b), turn: g.turn, level: 3 });
      if (dead || id !== S.hintId || S.g.moves.length !== at) return;
      S.hintBusy = false;
      if (!res || !R.flipsAt(S.g.b, res.sq, S.g.turn).length) { say('No hint this time.'); paint(); return; }
      S.hint = { sq: res.sq, t: performance.now() };
      S.hints++;
      const told = `Hint: ${sqName(res.sq)}, flipping ${R.flipsAt(S.g.b, res.sq, S.g.turn).length}.`;
      say(told);
      ctx.announce?.(told);
      loop.kick(reduced ? 0.05 : 1.7);
      paint();
    }

    function undo() {
      if (mode === 'online' || S.over || dead || S.paused) return;
      const g = S.g;
      if (mode === '2p') {
        if (!g.moves.length) return;
        dropHint();
        R.undo(g); S.by.pop();
      } else {
        const mine = S.by.lastIndexOf('me');
        if (mine < 0) return;
        dropHint();
        if (S.thinking) { brain.cancel(); S.thinkId++; S.thinking = false; }
        while (g.moves.length > mine) { R.undo(g); if (S.by.pop() === 'me') S.myMoves--; }
      }
      S.anim = []; S.last = g.moves.length ? g.moves[g.moves.length - 1] : -1; S.note = '';
      refreshLegal();
      snd.blip(330, 0.07, 'triangle', 0.6, 220);
      say('Move taken back.');
      paint();
      if (mode === 'cpu' && g.turn !== me) computerMove();
    }

    function resign() {
      if (S.over || dead) return;
      dropHint();
      if (S.thinking) { brain?.cancel(); S.thinkId++; S.thinking = false; }
      S.over = { over: true, winner: -me, reason: 'resign', who: 'me', ...R.count(S.g.b) };
      link?.resign();
      say('You resigned.');
      refreshLegal();
      paint();
      finishSoon();
    }

    function finishSoon(after = 0) {
      clearTimeout(S.endT);
      S.endT = setTimeout(finish, after + (reduced ? 300 : 900));
    }
    const vsLabel = (n, lv) => (n === 8 ? R.LEVELS[lv].name : `${n}×${n} · ${R.LEVELS[lv].name}`);
    const refreshRec = () => recLine?.set(records.vsOf('reversi', `${S.n}-${S.level}`), vsLabel(S.n, S.level));
    function finish() {
      if (S.ended || dead || !S.over) return;
      S.ended = true;
      paint();
      const o = S.over, { black, white } = R.count(S.g.b);
      const mineN = me === 1 ? black : white, theirN = me === 1 ? white : black;
      if (mode === 'online') {
        const won = o.winner === 0 ? null : o.winner === me;
        const detail = o.reason === 'resign' ? (o.who === 'me' ? 'You resigned.' : `${peerName} resigned.`) : `${mineN} discs to ${theirN}.`;
        ctx.onEnd({ score: null, won, versus: { me: won === null ? 0.5 : won ? 1 : 0, them: won === null ? 0.5 : won ? 0 : 1 }, detail });
        return;
      }
      if (mode === '2p') {
        ctx.onEnd({ score: null, detail: o.winner === 0 ? `A draw, ${black} discs each.` : `${nameOf(o.winner)} wins, ${o.winner === 1 ? black : white} discs to ${o.winner === 1 ? white : black}.` });
        return;
      }
      const lv = R.LEVELS[S.level].name;
      const where = S.n === 8 ? lv : `${lv}, ${S.n}×${S.n}`;
      const vs = { key: `${S.n}-${S.vsLevel}`, label: vsLabel(S.n, S.vsLevel), result: o.winner === me ? 'win' : o.winner === 0 ? 'draw' : 'loss' };
      const helped = S.hints ? { assisted: true } : {};
      const used = S.hints ? ` ${S.hints} hint${S.hints > 1 ? 's' : ''} used, so it sets no best.` : '';
      if (o.winner === me) ctx.onEnd({ score: mineN, won: true, vs, ...helped, detail: `You won ${mineN} discs to ${theirN} against the computer (${where}).${used}` });
      else if (o.winner === 0) ctx.onEnd({ score: null, won: false, vs, ...helped, detail: `A draw, ${mineN} discs each, against the computer (${where}).${used}` });
      else ctx.onEnd({ score: null, won: false, vs, ...helped, detail: (o.reason === 'resign' ? `You resigned against the computer (${where}).` : `The computer (${where}) won ${theirN} discs to ${mineN}.`) + used });
      /* the shell has written the record by now */
      refreshRec();
    }

    function setLevel(v) {
      S.level = v;
      /* a game counts at the easiest level the computer played in it */
      S.vsLevel = S.g.moves.length ? Math.min(S.vsLevel, v) : v;
      writePrefs({ level: v }); levelSeg.set(v); refreshRec(); paint(); refocus();
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
      const n = v === 6 ? 6 : 8;
      sizeSeg.set(n);
      if (n !== S.n) { S.n = n; writePrefs({ size: n }); newGame(); refreshRec(); }
      refocus();
    }

    /* ------------------------------ text ------------------------------ */
    function overText() {
      const o = S.over;
      if (!o) return '';
      const { black, white } = R.count(S.g.b);
      if (o.reason === 'resign') return o.who === 'me' ? 'You resigned.' : `${peerName} resigned: you win.`;
      if (o.winner === 0) return `A draw, ${black} discs each.`;
      if (mode === '2p') return `${nameOf(o.winner)} wins, ${o.winner === 1 ? black : white} to ${o.winner === 1 ? white : black}.`;
      return o.winner === me ? `You win, ${me === 1 ? black : white} to ${me === 1 ? white : black}!` : `${mode === 'cpu' ? 'The computer' : peerName} wins, ${me === 1 ? white : black} to ${me === 1 ? black : white}.`;
    }

    function paint() {
      if (dead) return;
      const g = S.g;
      const { black, white } = R.count(g.b);
      let text;
      if (S.over) text = overText();
      else if (S.paused) text = 'Paused';
      else if (mode === 'cpu') text = g.turn === me ? 'Your move' : 'The computer is thinking…';
      else if (mode === '2p') text = `${nameOf(g.turn)} to move`;
      else text = g.turn === me ? 'Your move' : `${peerName}’s move`;
      if (!S.over && !S.paused && S.hintBusy) text += ' · looking for a hint…';
      else if (!S.over && !S.paused && S.hint) text = `Hint: ${sqName(S.hint.sq)} (ringed)`;
      statusEl.textContent = S.note && !S.over ? `${S.note} ${text}` : text;
      statusEl.classList.remove('is-alert');
      statusEl.classList.toggle('is-done', !!S.over);
      const topV = mode === '2p' ? -1 : -me, botV = mode === '2p' ? 1 : me;
      const cnt = v => (v === 1 ? black : white);
      const who = v => (mode === '2p' ? (v === 1 ? 'Black' : 'White') : v === me ? 'You' : mode === 'cpu' ? 'Computer' : peerName);
      topStrip.set({ name: who(topV), note: `${topV === 1 ? 'Black' : 'White'} · ${cnt(topV)} discs${mode === 'cpu' ? ` · ${R.LEVELS[S.level].name}` : ''}`,
        color: colorOf(topV), turn: !S.over && g.turn === topV, thinking: S.thinking });
      botStrip.set({ name: who(botV), note: `${botV === 1 ? 'Black' : 'White'} · ${cnt(botV)} discs`, color: colorOf(botV), turn: !S.over && g.turn === botV });
      if (undoBtn) undoBtn.disabled = !!S.over || (mode === '2p' ? !g.moves.length : !S.by.includes('me'));
      if (resignBtn) { resignBtn.disabled = !!S.over; if (S.over) resignBtn.reset(); }
      if (hintBtn) {
        hintBtn.disabled = !canAct() || S.hintBusy;
        hintBtn.setLabel(S.hintBusy ? 'Thinking…' : S.hints ? `Hint · ${S.hints}` : 'Hint');
      }
      sf.cv.setAttribute('aria-label', `Reversi board, ${S.n} by ${S.n}. Black ${black}, White ${white}. ${text}`);
      ctx.onScore(mode === '2p' ? black + white : me === 1 ? black : me === -1 ? white : black);
      if (NET) NET.peerScore?.(me === 1 ? white : black);
      draw();
    }

    /* ------------------------------ drawing ------------------------------ */
    function layout() {
      const n = S.n, m = S.look.coords ? 0.5 : 0.12;
      const cell = Math.max(14, Math.floor(Math.min(sf.w, sf.h) / (n + m * 2 + 0.46)));
      return { cell, n, m: cell * m, x: Math.round((sf.w - cell * n) / 2), y: Math.round((sf.h - cell * n) / 2) };
    }
    const cx = (L, i) => L.x + ((i % L.n) + 0.5) * L.cell;
    const cy = (L, i) => L.y + (((i / L.n) | 0) + 0.5) * L.cell;
    const sqAt = (x, y) => {
      const L = S.geo, c = Math.floor((x - L.x) / L.cell), r = Math.floor((y - L.y) / L.cell);
      return c >= 0 && c < L.n && r >= 0 && r < L.n ? r * L.n + c : -1;
    };
    function disc(g, x, y, r, v, sx = 1, ring = false) {
      g.save();
      g.translate(x, y); g.scale(Math.max(0.04, sx), 1);
      const dk = v === 1;
      const gr = g.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
      gr.addColorStop(0, dk ? '#4b4d63' : '#ffffff');
      gr.addColorStop(1, dk ? '#0b0b11' : '#cdc7b8');
      g.fillStyle = gr;
      g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = r * 0.25; g.shadowOffsetY = r * 0.1;
      g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
      g.shadowColor = 'transparent';
      if (ring) { g.strokeStyle = dk ? 'rgba(255,255,255,.9)' : '#000'; g.lineWidth = Math.max(1.5, r * 0.09); g.beginPath(); g.arc(0, 0, r - g.lineWidth / 2, 0, Math.PI * 2); g.stroke(); }
      g.strokeStyle = dk ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.18)'; g.lineWidth = Math.max(1, r * 0.08);
      g.beginPath(); g.arc(0, 0, r * 0.72, 0, Math.PI * 2); g.stroke();
      g.restore();
    }

    function draw() {
      if (dead) return;
      const g = sf.g, T = THEMES[S.look.theme] || THEMES.arcade;
      sf.begin();
      const L = S.geo = layout();
      const n = L.n, now = performance.now(), c = L.cell, R0 = c * 0.41;
      g.fillStyle = '#05060d'; g.fillRect(0, 0, sf.w, sf.h);
      if (S.paused) {
        g.fillStyle = 'rgba(255,255,255,.8)'; g.textAlign = 'center'; g.font = `700 ${Math.round(c * 0.6)}px Inter,system-ui,sans-serif`;
        g.fillText('Paused', sf.w / 2, sf.h / 2);
        return;
      }
      let sx = 0;
      if (S.shake && now - S.shake < 200) sx = Math.sin((now - S.shake) / 18) * 4 * (1 - (now - S.shake) / 200);
      g.save(); g.translate(sx, 0);
      g.shadowBlur = 24; g.shadowColor = T.glow;
      const bg = g.createLinearGradient(0, L.y, 0, L.y + c * n);
      bg.addColorStop(0, T.bg[0]); bg.addColorStop(1, T.bg[1]);
      g.fillStyle = bg;
      rr(g, L.x - L.m, L.y - L.m, c * n + L.m * 2, c * n + L.m * 2, c * 0.2); g.fill();
      g.shadowBlur = 0;
      g.strokeStyle = T.line; g.lineWidth = T.lw;
      for (let k = 0; k <= n; k++) {
        g.beginPath(); g.moveTo(L.x + k * c, L.y); g.lineTo(L.x + k * c, L.y + n * c); g.moveTo(L.x, L.y + k * c); g.lineTo(L.x + n * c, L.y + k * c); g.stroke();
      }
      g.fillStyle = T.star;
      for (const a of [2, n - 2]) for (const b of [2, n - 2]) { g.beginPath(); g.arc(L.x + a * c, L.y + b * c, c * 0.06, 0, Math.PI * 2); g.fill(); }
      /* coordinates in the frame: a–h across the top, 1–8 down the left (a1 is the top left square) */
      if (S.look.coords) {
        g.fillStyle = T.ink;
        g.font = `600 ${Math.max(9, Math.round(c * 0.3))}px Inter,system-ui,sans-serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        for (let k = 0; k < n; k++) {
          g.fillText('abcdefgh'[k], L.x + (k + 0.5) * c, L.y - L.m * 0.5);
          g.fillText(String(k + 1), L.x - L.m * 0.5, L.y + (k + 0.5) * c);
        }
      }
      /* the last move */
      if (S.last >= 0) {
        g.strokeStyle = 'rgba(255,224,102,.85)'; g.lineWidth = 2.5;
        rr(g, L.x + (S.last % n) * c + 2, L.y + ((S.last / n) | 0) * c + 2, c - 4, c - 4, c * 0.12); g.stroke();
      }
      /* discs */
      const anims = new Map();
      for (const a of S.anim) if (now - a.t0 < a.dur + a.delay) anims.set(a.i, a);
      for (let i = 0; i < n * n; i++) {
        const v = S.g.b[i];
        if (!v) continue;
        const a = anims.get(i);
        if (!a) { disc(g, cx(L, i), cy(L, i), R0, v, 1, T.ring); continue; }
        const k = Math.max(0, Math.min(1, (now - a.t0 - a.delay) / Math.max(1, a.dur)));
        if (a.kind === 'drop') disc(g, cx(L, i), cy(L, i), R0 * (0.3 + 0.7 * k), v, 1, T.ring);
        else {
          const before = now - a.t0 < a.delay;
          const sc = before ? 1 : Math.abs(Math.cos(Math.PI * k));
          disc(g, cx(L, i), cy(L, i), R0, before || k < 0.5 ? -a.v : a.v, sc, T.ring);
        }
      }
      g.restore();
      /* where you may play (when the marks are on), and the hint */
      if (canAct() && !flipping()) {
        const hl = S.kb ? S.cursor : S.hover;
        const v = S.g.turn;
        if (S.look.moves) {
          for (const i of S.legal) {
            if (i === hl) { g.globalAlpha = 0.55; disc(g, cx(L, i), cy(L, i), R0, v, 1, T.ring); g.globalAlpha = 1; continue; }
            g.fillStyle = v === 1 ? 'rgba(10,10,20,.55)' : 'rgba(255,255,255,.65)';
            g.beginPath(); g.arc(cx(L, i), cy(L, i), c * 0.11, 0, Math.PI * 2); g.fill();
            if (T.ring) { g.strokeStyle = v === 1 ? 'rgba(255,255,255,.8)' : '#000'; g.lineWidth = 1.5; g.stroke(); }
          }
        }
        if (S.hint) {
          const i = S.hint.sq;
          const fresh = !reduced && now - S.hint.t < 1600;
          const a = fresh ? 0.7 + 0.3 * Math.cos((now - S.hint.t) / 130) : 1;
          g.strokeStyle = '#000'; g.lineWidth = Math.max(4, c * 0.1);
          g.beginPath(); g.arc(cx(L, i), cy(L, i), R0 * 1.02, 0, Math.PI * 2); g.stroke();
          g.strokeStyle = `rgba(62,230,168,${a})`; g.lineWidth = Math.max(2.5, c * 0.06);
          g.beginPath(); g.arc(cx(L, i), cy(L, i), R0 * 1.02, 0, Math.PI * 2); g.stroke();
        }
        if (S.kb) {
          g.strokeStyle = S.look.theme === 'arcade' || S.look.theme === 'wood' ? '#fff' : '#ff00ff'; g.lineWidth = 2; g.setLineDash([5, 4]);
          g.strokeRect(L.x + (S.cursor % n) * c + 3, L.y + ((S.cursor / n) | 0) * c + 3, c - 6, c - 6); g.setLineDash([]);
        }
      }
    }

    /* ------------------------------ input ------------------------------ */
    const at = e => { const r = sf.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const onDown = e => {
      if (e.button > 0 || dead) return;
      snd.wake();
      S.kb = false;
      const p = at(e), i = sqAt(p.x, p.y);
      if (i < 0) return;
      S.hover = i;
      tryPlace(i);
    };
    const onMove = e => {
      const i = sqAt(at(e).x, at(e).y);
      S.kb = false;
      if (i !== S.hover) { S.hover = i; sf.cv.style.cursor = i >= 0 && canAct() && (!S.look.moves || S.legal.includes(i)) ? 'pointer' : 'default'; draw(); }
    };
    const onLeave = () => { if (S.hover !== -1) { S.hover = -1; draw(); } };
    const onKey = e => {
      if (!ownsKey(el, e) || dead || S.ended || S.paused || board.isOpen()) return;
      const k = e.key, n = S.n;
      const d = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[k];
      if (d) {
        e.preventDefault(); snd.wake(); S.kb = true;
        const r = Math.max(0, Math.min(n - 1, ((S.cursor / n) | 0) + d[0])), c = Math.max(0, Math.min(n - 1, (S.cursor % n) + d[1]));
        S.cursor = r * n + c;
        draw();
        return;
      }
      if (k === 'Enter' || k === ' ') { if (S.over) return; e.preventDefault(); snd.wake(); S.kb = true; tryPlace(S.cursor); return; }
      if ((k === 'h' || k === 'H') && mode !== 'online') { e.preventDefault(); hint(); return; }
      if ((k === 'u' || k === 'U' || k === 'z' || k === 'Z' || k === 'Backspace') && mode !== 'online') { e.preventDefault(); undo(); }
    };
    window.addEventListener('keydown', onKey);
    sf.cv.addEventListener('pointerdown', onDown);
    sf.cv.addEventListener('pointermove', onMove);
    sf.cv.addEventListener('pointerleave', onLeave);

    refreshRec();
    newGame();

    const api = {
      stop() {
        dead = true;
        clearTimeout(S.endT);
        board.close();
        brain?.close();
        link?.stop();
        loop.stop();
        window.removeEventListener('keydown', onKey);
        sf.cv.removeEventListener('pointerdown', onDown);
        sf.cv.removeEventListener('pointermove', onMove);
        sf.cv.removeEventListener('pointerleave', onLeave);
        resignBtn?.reset();
        snd.close();
        sf.destroy();
        root.remove();
      },
      /* what a watcher may see (./spectate.js): B = black (moves first), W = white */
      spectate: () => {
        const { black, white } = R.count(S.g.b);
        const first = mode === '2p' ? 'Black' : me === 1 ? 'You' : (mode === 'cpu' ? 'Computer' : peerName);
        const second = mode === '2p' ? 'White' : me === -1 ? 'You' : (mode === 'cpu' ? 'Computer' : peerName);
        return { k: 'board', st: 'rev', w: S.n, h: S.n, cells: R.toRows(S.g.b).join('').replace(/X/g, 'B').replace(/O/g, 'W'), hl: [], txt: statusEl.textContent, over: !!S.over, x: null, turn: S.over ? 0 : S.g.turn,
          pl: [{ n: first, m: `Black ${black}` }, { n: second, m: `White ${white}` }] };
      },
      peek: () => {
        const { black, white } = R.count(S.g.b);
        const id = v => (v === 1 ? 1 : v === -1 ? 2 : 0);
        return {
          mode, n: S.n, me: mode === '2p' ? null : id(me), turn: id(S.g.turn), board: R.toRows(S.g.b), black, white, legal: S.legal.slice(), moves: S.g.moves.join(','),
          over: S.over ? { winner: id(S.over.winner), reason: S.over.reason || 'full' } : null, note: S.note, level: S.level, vsLevel: S.vsLevel, first: S.first, thinking: S.thinking,
          worker: !!brain?.worker, rejected: S.rejected, flipping: flipping(), myMoves: S.myMoves, ended: S.ended, paused: S.paused, geo: { ...S.geo }, status: statusEl.textContent,
          look: { ...S.look }, hint: S.hint ? S.hint.sq : null, hints: S.hints, hintBusy: S.hintBusy,
        };
      },
      /* test hook — nothing in the game calls it (and never online): set({ rows: ['X..',…], turn: 1|2 }) plays on from that
         position (8 rows of 8, or 6 of 6: the board takes that size) */
      hook(cmd, arg) {
        if (cmd !== 'set' || mode === 'online' || !Array.isArray(arg?.rows)) return false;
        brain?.cancel(); clearTimeout(S.endT);
        S.thinkId++; S.hintId++;
        const g0 = R.fromString(arg.rows, arg.turn === 2 ? -1 : 1);
        const n = R.sizeOf(g0.b);
        if (n !== S.n) { S.n = n; sizeSeg?.set(n); refreshRec(); }
        Object.assign(S, { g: g0, by: [], over: null, anim: [], last: -1, thinking: false, myMoves: 0, ended: false, note: '', hint: null, hints: 0, hintBusy: false, vsLevel: S.level });
        refreshLegal();
        paint();
        return true;
      },
    };
    if (mode !== 'online') {
      api.pause = () => {
        if (S.paused) return;
        S.paused = true;
        if (S.hintBusy) dropHint();
        if (S.thinking) { brain?.cancel(); S.thinkId++; S.thinking = false; }
        paint();
      };
      api.resume = () => {
        if (!S.paused) return;
        S.paused = false;
        paint();
        if (mode === 'cpu' && !S.over && S.g.turn !== me) computerMove();
      };
    }
    return api;
  },
};
