/* ============================================================
   arcade/checkers.js — Checkers for Static Arcade: American rules, or
   flying kings.

   Red moves first. A man steps one square diagonally forward; reach the
   far row and it is crowned a king. Capturing is forced: if you can jump,
   you must, and a piece that lands with another jump open must keep going.
   You choose which jump to make, not necessarily the longest. A side with
   no move loses; 40 moves each (80 in a row) without a capture is a draw.
   · American (the default, and the only rules online): men jump forward
     only, kings move one square, and a man crowned mid-jump stops.
   · Flying kings (Russian rules): kings move and capture any distance
     along a diagonal, men capture backwards too, and a man crowned
     mid-capture carries on as a king.
   The rules, with the computer player, are in ./checkers-rules.js; the
   rules in play are said in the panel and in the Board card.

   · 1P: against the computer (Easy, Medium, Hard, searched in a Web Worker
     so the page keeps drawing), you or the computer first, either rules;
     remembered in portal.arcadeCheckers. Undo takes back your move and the
     reply. A win scores the number of moves you made (fewer is better).
     Your won–lost–drawn record is kept per rules and level (records.js);
     a game counts at the easiest level the computer played in it.
   · 2P: Red and Cream take turns on one screen.
   · Online: a friend on another device through the Arcade's room. The host
     is Red in odd rounds, Cream in even ones; your side is always at the
     bottom. Every arriving move is checked against the rules (whose turn,
     a real legal move, forced captures included) before it reaches the board.
   · Hint (1P and 2P, never online): the computer's Hard move for the side
     to move, marked on the board until the next move and said for a screen
     reader. Hints are counted; a 1P game with one sets no best. The Board
     card: four themes and coordinates (files a–h, ranks 1–8 from Red's side).

   Mouse or touch: click a piece (pieces that may move are lit), then a
   dotted square; a multi-jump is clicked hop by hop. Keyboard: arrows move
   the cursor, Enter / Space pick a piece or a square, H hint, U / Z /
   Backspace take back (first the piece you are holding). Moves slide hop by
   hop, instantly with reduced motion. Pause hides the board and stops the
   computer.
   ============================================================ */
import { h } from '../core/dom.js';
import { store } from '../core/store.js';
import * as K from './checkers-rules.js';
import * as records from './records.js';
import { thinker } from './thinker.js';
import { KIT_CSS, surface, ownsKey, sounder, looper, rr, playerStrip, segment, button, confirmButton, duelLink, boardOptions, recordLine, lookOf } from './boardkit.js';

const PREF = 'portal.arcadeCheckers';
const MIN_THINK_MS = 420;
const HOP_MS = 240;
const RED = '#e0414f', CREAM = '#f1e6cc';
/* the board in each theme: arcade is the look Checkers always had */
const THEMES = {
  arcade: { frame: '#3a2a22', glow: 'rgba(255,170,80,.3)', dark: '#6b4a37', light: '#e4d2ac', ink: '#ead8bc', ring: null },
  wood: { frame: '#4a2c14', glow: 'rgba(255,170,80,.22)', dark: '#8a5a2e', light: '#ebc893', ink: '#f3dcb2', ring: null },
  paper: { frame: '#d6cfbf', glow: 'rgba(255,255,255,.08)', dark: '#8c99a5', light: '#f8f5ee', ink: '#2c2c32', ring: 'rgba(0,0,0,.45)' },
  contrast: { frame: '#ffd400', glow: 'rgba(0,0,0,0)', dark: '#000000', light: '#ffffff', ink: '#000000', ring: '#ffffff' },
};
const SAMPLES = { arcade: ['#e4d2ac', '#6b4a37'], wood: ['#ebc893', '#8a5a2e'], paper: ['#f8f5ee', '#8c99a5'], contrast: ['#ffffff', '#000000'] };

const readPrefs = () => {
  let p = null;
  try { p = store.get(PREF, null); } catch (err) { p = null; }
  return { level: [1, 2, 3].includes(p?.level) ? p.level : 2, first: p?.first === 'cpu' ? 'cpu' : 'me', rules: K.rulesId(p?.rules), ...lookOf(p, { coords: false }) };
};
const writePrefs = patch => { try { store.set(PREF, { ...readPrefs(), ...patch }); } catch (err) { /* a convenience */ } };
const startsWith = (path, prefix) => prefix.length <= path.length && prefix.every((x, i) => path[i] === x);

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
    /* me is the value of my pieces: 1 Red (first), -1 Cream */
    let me = mode === 'online' ? ((round % 2 === 1) === host ? 1 : -1) : mode === 'cpu' ? (prefs.first === 'cpu' ? -1 : 1) : 0;
    let dead = false;

    /* online is always American */
    const rules0 = mode === 'online' ? 'am' : prefs.rules;
    const S = {
      rules: rules0, g: K.newGame(rules0), by: [], over: null, anim: null, last: null, hover: -1, cursor: 17, kb: false, legal: [], sel: -1, prefix: [], note: '',
      thinking: false, thinkId: 0, level: prefs.level, vsLevel: prefs.level, first: prefs.first, rejected: 0, myMoves: 0, paused: false,
      ended: false, endT: 0, geo: { x: 0, y: 0, cell: 0 }, shake: 0, hint: null, hints: 0, hintBusy: false, hintId: 0,
      look: { theme: prefs.theme, coords: prefs.coords },
    };
    const flipped = () => me === -1;
    const colorOf = v => (v === 1 ? RED : CREAM);
    const sideName = v => (v === 1 ? 'Red' : 'Cream');
    const nameOf = v => (mode === '2p' ? sideName(v) : v === me ? 'You' : mode === 'cpu' ? 'The computer' : peerName);
    const R0 = () => K.RULES[S.rules];

    /* ------------------------------ the page ------------------------------ */
    const boardEl = h('div.arx-bg__board');
    const sr = h('div.arx-bg__sr', { 'aria-live': 'polite' });
    const statusEl = h('div.arx-bg__status', { role: 'status' });
    const topStrip = playerStrip(CREAM, '', '');
    const botStrip = playerStrip(RED, '', '');
    const levelSeg = mode === 'cpu' ? segment('Level', [1, 2, 3].map(id => ({ id, label: K.LEVELS[id].name })), S.level, setLevel) : null;
    const recLine = mode === 'cpu' ? recordLine() : null;
    const firstSeg = mode === 'cpu' ? segment('First', [{ id: 'me', label: 'You' }, { id: 'cpu', label: 'Computer' }], S.first, setFirst) : null;
    const rulesSeg = mode !== 'online' ? segment('Rules', [{ id: 'am', label: 'American', title: K.RULES.am.short }, { id: 'fly', label: 'Flying kings', title: K.RULES.fly.short }], S.rules, setRules) : null;
    const undoBtn = mode !== 'online' ? button('Undo', 'corner-up-left', () => { undo(); refocus(); }, { title: 'Take back the last move (U)' }) : null;
    const resignBtn = mode !== '2p' ? confirmButton('Resign', 'Resign? Click again', 'x', () => { resign(); refocus(); }) : null;
    const hintBtn = mode !== 'online' ? button('Hint', 'sparkles', () => { hint(); refocus(); }, { title: 'Mark the move the computer would play at Hard (H). Hints are counted, and a game with one sets no best.' }) : null;
    const board = boardOptions(boardEl, {
      samples: SAMPLES, coords: true,
      get: () => ({ ...S.look }),
      set: (k, v) => { S.look[k] = k === 'theme' ? v : !!v; writePrefs({ [k]: S.look[k] }); paint(); },
      get rules() { return R0().text; },
      refocus: () => refocus(),
    });
    const note = h('div.arx-bg__note');
    const setNote = () => {
      note.textContent = (mode === 'online' ? 'Click a lit piece, then a dotted square. You must capture when you can. Every move is checked on both screens. '
        : mode === '2p' ? 'Two players on this screen: Red goes first. You must capture when you can. '
          : 'Click a lit piece, then a dotted square. You must capture when you can; keep jumping with the same piece. ') + R0().short;
    };
    setNote();
    const side = h('div.arx-bg__side', topStrip.el, statusEl, levelSeg?.el, recLine?.el, firstSeg?.el, rulesSeg?.el,
      h('div.arx-bg__row', undoBtn, resignBtn), h('div.arx-bg__row', hintBtn, board.button), note, botStrip.el);
    const root = h('div.arx-bgc', h('style', { text: KIT_CSS }), h('div.arx-bg', boardEl, side), sr);
    el.appendChild(root);
    const sf = surface(boardEl, 'Checkers board', () => draw());
    const loop = looper(() => draw());
    const refocus = () => el.closest('[tabindex]')?.focus({ preventScroll: true });
    const say = t => { sr.textContent = t; };

    const link = NET ? duelLink(NET, {
      plies: () => S.g.moves.length,
      mine: i => S.by[i] === 'me',
      wire: i => ({ p: S.g.moves[i] }),
      take: d => {
        if (S.over || S.g.turn !== -me || !Array.isArray(d.p) || d.p.length > 14) return false;
        const m = K.findMove(S.g, d.p);
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
    const humanTurn = () => mode === '2p' || S.g.turn === me;
    const canAct = () => !dead && !S.paused && !S.over && !S.thinking && humanTurn();
    const moving = () => !!S.anim && performance.now() - S.anim.t0 < S.anim.total;
    const refreshLegal = () => { S.legal = S.over ? [] : K.legal(S.g); };
    const forced = () => S.legal.length > 0 && S.legal[0].caps.length > 0;
    const clearSel = () => { S.sel = -1; S.prefix = []; };
    /* a hint still being worked out is dropped when the board changes */
    const dropHint = () => {
      if (S.hintBusy) { brain?.cancel(); S.hintBusy = false; }
      S.hintId++;
      S.hint = null;
    };

    function newGame() {
      brain?.cancel();
      clearTimeout(S.endT);
      Object.assign(S, { g: K.newGame(S.rules), by: [], over: null, anim: null, last: null, thinking: false, myMoves: 0, ended: false, note: '', cursor: me === -1 ? 46 : 17,
        hint: null, hints: 0, hintBusy: false, vsLevel: S.level });
      clearSel();
      S.thinkId++; S.hintId++;
      refreshLegal();
      ctx.onScore(0);
      NET?.peerScore?.(0);
      paint();
      if (mode === 'cpu' && S.g.turn !== me) computerMove();
    }

    function refuse(msg) {
      S.shake = performance.now();
      S.note = msg || '';
      snd.blip(140, 0.08, 'sawtooth', 0.4);
      loop.kick(0.25);
      if (msg) { statusEl.textContent = msg; statusEl.classList.add('is-alert'); say(msg); }
    }

    /* a click or Enter on square i (a piece to pick up, or a landing square) */
    function pick(i) {
      if (!canAct() || i < 0) return false;
      const v = S.g.b[i];
      if (v && Math.sign(v) === S.g.turn) {
        if (S.prefix.length > 1) { refuse('Keep jumping with the same piece.'); return false; }
        if (S.sel === i) { clearSel(); paint(); return true; }
        if (!S.legal.some(m => m.path[0] === i)) { refuse(forced() ? 'You must capture: pick a lit piece.' : 'That piece has no move.'); return false; }
        S.sel = i; S.prefix = [i]; S.note = '';
        snd.blip(420, 0.04, 'triangle', 0.5);
        paint();
        return true;
      }
      if (S.sel < 0) { if (!v) return false; refuse('That is not your piece.'); return false; }
      const cands = S.legal.filter(m => startsWith(m.path, S.prefix) && m.path[S.prefix.length] === i);
      if (!cands.length) {
        refuse(forced() ? 'You must capture. Pick a dotted square.'
          : S.rules === 'fly' ? 'A man steps one square diagonally forward; a king slides along a diagonal.' : 'A piece moves one square diagonally forward.');
        return false;
      }
      const prefix = [...S.prefix, i];
      const done = cands.find(m => m.path.length === prefix.length);
      if (done) {
        clearSel();
        apply(done, 'me');
        link?.sendMove(S.g.moves.length - 1);
        return true;
      }
      S.prefix = prefix;
      snd.blip(520, 0.05, 'triangle', 0.6);
      paint();
      return true;
    }

    function apply(m, by) {
      const g = S.g;
      const v = g.turn;
      const piece = g.b[m.path[0]];
      const caught = m.caps.map(s => g.b[s]);
      dropHint();
      K.apply(g, m);
      S.by.push(by);
      if (by === 'me') S.myMoves++;
      S.last = { from: m.path[0], to: m.path[m.path.length - 1] };
      const hops = m.path.length - 1;
      const total = reduced ? 0 : hops * HOP_MS;
      S.anim = { m, piece, caught, t0: performance.now(), total, v };
      loop.kick(total / 1000 + 0.15);
      snd.blip(m.caps.length ? 240 : 360, 0.07, 'triangle', 0.8);
      const o = K.outcome(g);
      if (o.over) S.over = o;
      refreshLegal();
      S.note = '';
      const told = `${nameOf(v)} moved ${K.name(m.path[0])} to ${K.name(m.path[hops])}${m.caps.length ? `, capturing ${m.caps.length}` : ''}.${S.over ? ' ' + overText() : ''}`;
      say(told);
      /* the other side's move, for a screen reader (the shell's live region): yours you just made */
      if (by !== 'me' || mode === '2p') ctx.announce?.(told);
      paint();
      if (S.over) finishSoon(total);
      else if (mode === 'cpu' && g.turn !== me) computerMove(total);
    }

    async function computerMove(wait0 = 0) {
      if (S.paused) return;
      const id = ++S.thinkId;
      S.thinking = true;
      paint();
      const t0 = performance.now();
      const g = S.g;
      const res = await brain.ask({ game: 'checkers', b: Array.from(g.b), turn: g.turn, quiet: g.quiet, level: S.level, rules: g.rules });
      if (dead || id !== S.thinkId) return;
      const wait = Math.max(MIN_THINK_MS, wait0 + 80) - (performance.now() - t0);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      if (dead || id !== S.thinkId) return;
      S.thinking = false;
      const m = res && K.findMove(S.g, res.path);
      if (!m) {
        statusEl.textContent = 'The computer could not move. Press Undo or start again.';
        statusEl.classList.add('is-alert');
        return;
      }
      apply(m, 'cpu');
    }

    /* the computer's Hard move for the side to move, marked until the next move */
    async function hint() {
      if (mode === 'online' || !canAct() || S.hintBusy || S.prefix.length > 1) return;
      if (!brain) brain = thinker();
      const id = ++S.hintId, at = S.g.moves.length, g = S.g;
      S.hintBusy = true;
      S.hint = null;
      say('Looking for a good move…');
      paint();
      const res = await brain.ask({ game: 'checkers', b: Array.from(g.b), turn: g.turn, quiet: g.quiet, level: 3, rules: g.rules });
      if (dead || id !== S.hintId || S.g.moves.length !== at) return;
      S.hintBusy = false;
      const m = res && K.findMove(S.g, res.path);
      if (!m) { say('No hint this time.'); paint(); return; }
      S.hint = { path: m.path.slice(), caps: m.caps.slice(), t: performance.now() };
      S.hints++;
      const told = `Hint: ${m.path.map(K.name).join(' to ')}${m.caps.length ? `, capturing ${m.caps.length}` : ''}.`;
      say(told);
      ctx.announce?.(told);
      loop.kick(reduced ? 0.05 : 1.7);
      paint();
    }

    function undo() {
      if (mode === 'online' || dead || S.paused) return;
      if (S.sel >= 0) { clearSel(); paint(); return; }
      if (S.over) return;
      const g = S.g;
      if (mode === '2p') {
        if (!g.moves.length) return;
        dropHint();
        K.undo(g); S.by.pop();
      } else {
        const mine = S.by.lastIndexOf('me');
        if (mine < 0) return;
        dropHint();
        if (S.thinking) { brain.cancel(); S.thinkId++; S.thinking = false; }
        while (g.moves.length > mine) { K.undo(g); if (S.by.pop() === 'me') S.myMoves--; }
      }
      S.anim = null; S.last = null;
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
      S.over = { over: true, winner: -me, reason: 'resign', who: 'me' };
      link?.resign();
      clearSel();
      say('You resigned.');
      refreshLegal();
      paint();
      finishSoon();
    }

    function finishSoon(after = 0) {
      clearTimeout(S.endT);
      S.endT = setTimeout(finish, after + (reduced ? 300 : 900));
    }
    const vsLabel = (rules, lv) => `${K.RULES[rules].name} · ${K.LEVELS[lv].name}`;
    const refreshRec = () => recLine?.set(records.vsOf('checkers', `${S.rules}-${S.level}`), vsLabel(S.rules, S.level));
    function finish() {
      if (S.ended || dead || !S.over) return;
      S.ended = true;
      paint();
      const o = S.over, n = S.myMoves;
      if (mode === 'online') {
        const won = o.winner === 0 ? null : o.winner === me;
        const detail = o.reason === 'resign' ? (o.who === 'me' ? 'You resigned.' : `${peerName} resigned.`)
          : o.winner === 0 ? 'A draw: 40 moves each without a capture.' : won ? 'The other side has no move left.' : 'You have no move left.';
        ctx.onEnd({ score: null, won, versus: { me: won === null ? 0.5 : won ? 1 : 0, them: won === null ? 0.5 : won ? 0 : 1 }, detail });
        return;
      }
      if (mode === '2p') {
        ctx.onEnd({ score: null, detail: o.winner === 0 ? 'A draw: 40 moves each without a capture.' : `${sideName(o.winner)} wins.` });
        return;
      }
      const lv = K.LEVELS[S.level].name;
      const where = S.rules === 'fly' ? `${lv}, flying kings` : lv;
      const vs = { key: `${S.rules}-${S.vsLevel}`, label: vsLabel(S.rules, S.vsLevel), result: o.winner === me ? 'win' : o.winner === 0 ? 'draw' : 'loss' };
      const helped = S.hints ? { assisted: true } : {};
      const used = S.hints ? ` ${S.hints} hint${S.hints > 1 ? 's' : ''} used, so it sets no best.` : '';
      if (o.winner === me) ctx.onEnd({ score: n, won: true, vs, ...helped, detail: `You won in ${n} moves against the computer (${where}).${used}` });
      else if (o.winner === 0) ctx.onEnd({ score: null, won: false, vs, ...helped, detail: `A draw against the computer (${where}): 40 moves each without a capture.${used}` });
      else ctx.onEnd({ score: null, won: false, vs, ...helped, detail: (o.reason === 'resign' ? `You resigned against the computer (${where}).` : `The computer (${where}) won.`) + used });
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
    function setRules(v) {
      const id = K.rulesId(v);
      rulesSeg.set(id);
      if (id !== S.rules) {
        S.rules = id;
        writePrefs({ rules: id });
        setNote();
        newGame();
        refreshRec();
        say(K.RULES[id].short);
      }
      refocus();
    }

    /* ------------------------------ text ------------------------------ */
    function overText() {
      const o = S.over;
      if (!o) return '';
      if (o.reason === 'resign') return o.who === 'me' ? 'You resigned.' : `${peerName} resigned: you win.`;
      if (o.winner === 0) return 'A draw: 40 moves each without a capture.';
      if (mode === '2p') return `${sideName(o.winner)} wins!`;
      return o.winner === me ? 'You win!' : `${mode === 'cpu' ? 'The computer' : peerName} wins.`;
    }

    function paint() {
      if (dead) return;
      const g = S.g;
      const c = K.counts(g.b);
      let text;
      if (S.over) text = overText();
      else if (S.paused) text = 'Paused';
      else if (mode === 'cpu') text = g.turn === me ? (forced() ? 'Your move: you must capture' : 'Your move') : 'The computer is thinking…';
      else if (mode === '2p') text = `${nameOf(g.turn)} to move${forced() ? ': must capture' : ''}`;
      else text = g.turn === me ? (forced() ? 'Your move: you must capture' : 'Your move') : `${peerName}’s move`;
      if (!S.over && !S.paused && S.hintBusy) text += ' · looking for a hint…';
      else if (!S.over && !S.paused && S.hint) text = `Hint: ${S.hint.path.map(K.name).join(' to ')} (marked)`;
      statusEl.textContent = text;
      statusEl.classList.remove('is-alert');
      statusEl.classList.toggle('is-done', !!S.over);
      const topV = mode === '2p' ? -1 : -me, botV = mode === '2p' ? 1 : me;
      const cnt = v => (v === 1 ? c.red : c.cream), kings = v => (v === 1 ? c.redKings : c.creamKings);
      const who = v => (mode === '2p' ? sideName(v) : v === me ? 'You' : mode === 'cpu' ? 'Computer' : peerName);
      topStrip.set({ name: who(topV), note: `${sideName(topV)} · ${cnt(topV)} left${kings(topV) ? `, ${kings(topV)} king${kings(topV) > 1 ? 's' : ''}` : ''}${mode === 'cpu' ? ` · ${K.LEVELS[S.level].name}` : ''}`,
        color: colorOf(topV), turn: !S.over && g.turn === topV, thinking: S.thinking });
      botStrip.set({ name: who(botV), note: `${sideName(botV)} · ${cnt(botV)} left${kings(botV) ? `, ${kings(botV)} king${kings(botV) > 1 ? 's' : ''}` : ''}`, color: colorOf(botV), turn: !S.over && g.turn === botV });
      if (undoBtn) undoBtn.disabled = !!S.over || (mode === '2p' ? !g.moves.length : !S.by.includes('me'));
      if (resignBtn) { resignBtn.disabled = !!S.over; if (S.over) resignBtn.reset(); }
      if (hintBtn) {
        hintBtn.disabled = !canAct() || S.hintBusy || S.prefix.length > 1;
        hintBtn.setLabel(S.hintBusy ? 'Thinking…' : S.hints ? `Hint · ${S.hints}` : 'Hint');
      }
      sf.cv.setAttribute('aria-label', `Checkers board, ${R0().name} rules. Red ${c.red}, Cream ${c.cream}. ${text}`);
      ctx.onScore(mode === '2p' ? g.moves.length : S.myMoves);
      if (NET) NET.peerScore?.(S.by.filter(b => b === 'peer').length);
      draw();
    }

    /* ------------------------------ drawing ------------------------------ */
    function layout() {
      const m = S.look.coords ? 0.5 : 0.14;
      const cell = Math.max(14, Math.floor(Math.min(sf.w, sf.h) / (8 + m * 2 + 0.32)));
      return { cell, m: cell * m, x: Math.round((sf.w - cell * 8) / 2), y: Math.round((sf.h - cell * 8) / 2) };
    }
    /* centre of square i (0..63) on screen */
    const sx = (L, i) => L.x + ((flipped() ? 7 - (i & 7) : (i & 7)) + 0.5) * L.cell;
    const sy = (L, i) => L.y + ((flipped() ? (i >> 3) : 7 - (i >> 3)) + 0.5) * L.cell;
    const sqAt = (x, y) => {
      const L = S.geo, c = Math.floor((x - L.x) / L.cell), r = Math.floor((y - L.y) / L.cell);
      if (c < 0 || c > 7 || r < 0 || r > 7) return -1;
      return K.sq(flipped() ? r : 7 - r, flipped() ? 7 - c : c);
    };
    function piece(g, x, y, r, v, lit, ring = null) {
      const red = v > 0, king = v === 2 || v === -2;
      g.save();
      g.translate(x, y);
      if (lit) { g.shadowColor = 'rgba(255,230,120,.95)'; g.shadowBlur = r * 0.8; }
      else { g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = r * 0.3; g.shadowOffsetY = r * 0.12; }
      const gr = g.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
      gr.addColorStop(0, red ? '#ff8a93' : '#ffffff');
      gr.addColorStop(1, red ? '#a81f2e' : '#cdbf9c');
      g.fillStyle = gr;
      g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
      g.shadowColor = 'transparent';
      if (ring) { g.strokeStyle = ring; g.lineWidth = Math.max(1.5, r * 0.1); g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); }
      g.strokeStyle = red ? 'rgba(60,0,10,.45)' : 'rgba(80,60,20,.4)'; g.lineWidth = Math.max(1, r * 0.09);
      g.beginPath(); g.arc(0, 0, r * 0.72, 0, Math.PI * 2); g.stroke();
      if (king) {
        g.fillStyle = '#ffd84d'; g.strokeStyle = '#8a6200'; g.lineWidth = Math.max(1, r * 0.07);
        g.beginPath();
        g.moveTo(-r * 0.42, r * 0.22); g.lineTo(-r * 0.5, -r * 0.3); g.lineTo(-r * 0.22, -r * 0.05); g.lineTo(0, -r * 0.42);
        g.lineTo(r * 0.22, -r * 0.05); g.lineTo(r * 0.5, -r * 0.3); g.lineTo(r * 0.42, r * 0.22); g.closePath();
        g.fill(); g.stroke();
      }
      g.restore();
    }

    function draw() {
      if (dead) return;
      const g = sf.g, T = THEMES[S.look.theme] || THEMES.arcade;
      sf.begin();
      const L = S.geo = layout();
      const now = performance.now(), c = L.cell, R0r = c * 0.38;
      g.fillStyle = '#05060d'; g.fillRect(0, 0, sf.w, sf.h);
      if (S.paused) {
        g.fillStyle = 'rgba(255,255,255,.8)'; g.textAlign = 'center'; g.font = `700 ${Math.round(c * 0.6)}px Inter,system-ui,sans-serif`;
        g.fillText('Paused', sf.w / 2, sf.h / 2);
        return;
      }
      let ox = 0;
      if (S.shake && now - S.shake < 200) ox = Math.sin((now - S.shake) / 18) * 4 * (1 - (now - S.shake) / 200);
      g.save(); g.translate(ox, 0);
      g.shadowBlur = 24; g.shadowColor = T.glow;
      g.fillStyle = T.frame;
      rr(g, L.x - L.m, L.y - L.m, c * 8 + L.m * 2, c * 8 + L.m * 2, c * 0.2); g.fill();
      g.shadowBlur = 0;
      for (let r = 0; r < 8; r++) for (let q = 0; q < 8; q++) {
        const rr0 = flipped() ? r : 7 - r, cc = flipped() ? 7 - q : q;
        g.fillStyle = K.dark(rr0, cc) ? T.dark : T.light;
        g.fillRect(L.x + q * c, L.y + r * c, c, c);
      }
      /* coordinates in the frame: files along the bottom, ranks up the left, as you see the board */
      if (S.look.coords) {
        g.fillStyle = T.ink;
        g.font = `600 ${Math.max(9, Math.round(c * 0.3))}px Inter,system-ui,sans-serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        for (let k = 0; k < 8; k++) {
          const file = flipped() ? 7 - k : k, rank = flipped() ? k + 1 : 8 - k;
          g.fillText('abcdefgh'[file], L.x + (k + 0.5) * c, L.y + 8 * c + L.m * 0.5);
          g.fillText(String(rank), L.x - L.m * 0.5, L.y + (k + 0.5) * c);
        }
      }
      if (S.last) {
        g.strokeStyle = 'rgba(255,224,102,.8)'; g.lineWidth = 2.5;
        for (const i of [S.last.from, S.last.to]) g.strokeRect(sx(L, i) - c / 2 + 2, sy(L, i) - c / 2 + 2, c - 4, c - 4);
      }
      /* the hint: its squares outlined, the hops joined by a line */
      if (S.hint && !S.over) {
        const p = S.hint.path;
        const fresh = !reduced && now - S.hint.t < 1600;
        const a = fresh ? 0.7 + 0.3 * Math.cos((now - S.hint.t) / 130) : 1;
        g.lineWidth = Math.max(3, c * 0.08);
        g.strokeStyle = '#000';
        g.beginPath(); p.forEach((s, k) => (k ? g.lineTo(sx(L, s), sy(L, s)) : g.moveTo(sx(L, s), sy(L, s)))); g.stroke();
        g.strokeStyle = `rgba(62,230,168,${a})`; g.lineWidth = Math.max(2, c * 0.05);
        g.beginPath(); p.forEach((s, k) => (k ? g.lineTo(sx(L, s), sy(L, s)) : g.moveTo(sx(L, s), sy(L, s)))); g.stroke();
        for (const s of p) {
          g.strokeStyle = '#000'; g.lineWidth = 5; g.strokeRect(sx(L, s) - c / 2 + 4, sy(L, s) - c / 2 + 4, c - 8, c - 8);
          g.strokeStyle = `rgba(62,230,168,${a})`; g.lineWidth = 3; g.strokeRect(sx(L, s) - c / 2 + 4, sy(L, s) - c / 2 + 4, c - 8, c - 8);
        }
      }
      /* pieces; a move in flight is drawn by hand */
      const an = S.anim && now - S.anim.t0 < S.anim.total ? S.anim : null;
      const lit = new Set(canAct() && S.prefix.length < 2 ? S.legal.map(m => m.path[0]) : []);
      const hopsDone = an ? (now - an.t0) / HOP_MS : 99;
      const mid = S.prefix.length > 1 ? S.legal.find(m => startsWith(m.path, S.prefix)) : null;
      for (let i = 0; i < 64; i++) {
        const v = S.g.b[i];
        if (an && i === an.m.path[an.m.path.length - 1]) continue;
        if (!v) continue;
        if (mid && mid.caps.slice(0, S.prefix.length - 1).includes(i)) { g.globalAlpha = 0.35; piece(g, sx(L, i), sy(L, i), R0r, v, false, T.ring); g.globalAlpha = 1; continue; }
        if (mid && i === S.prefix[0]) continue;
        piece(g, sx(L, i), sy(L, i), R0r, v, lit.has(i) || (S.sel === i && S.prefix.length < 2), T.ring);
      }
      if (an) {
        an.m.caps.forEach((s, k) => { if (hopsDone < k + 1) piece(g, sx(L, s), sy(L, s), R0r, an.caught[k], false, T.ring); });
        const k = Math.min(an.m.path.length - 1, Math.floor(hopsDone)), f = Math.min(1, hopsDone - k);
        const a = an.m.path[k], b = an.m.path[Math.min(k + 1, an.m.path.length - 1)];
        const px = sx(L, a) + (sx(L, b) - sx(L, a)) * f, py = sy(L, a) + (sy(L, b) - sy(L, a)) * f - Math.sin(f * Math.PI) * c * 0.12;
        piece(g, px, py, R0r, an.piece, false, T.ring);
      }
      if (mid) piece(g, sx(L, S.prefix[S.prefix.length - 1]), sy(L, S.prefix[S.prefix.length - 1]), R0r, S.g.b[S.prefix[0]], true, T.ring);
      g.restore();
      /* where the held piece may go */
      if (canAct() && S.sel >= 0) {
        g.fillStyle = 'rgba(255,230,120,.9)';
        const seen = new Set();
        for (const m of S.legal) if (startsWith(m.path, S.prefix) && m.path.length > S.prefix.length) {
          const t = m.path[S.prefix.length];
          if (seen.has(t)) continue;
          seen.add(t);
          g.beginPath(); g.arc(sx(L, t), sy(L, t), c * 0.14, 0, Math.PI * 2); g.fill();
          if (t === (S.kb ? S.cursor : S.hover)) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.strokeRect(sx(L, t) - c / 2 + 3, sy(L, t) - c / 2 + 3, c - 6, c - 6); }
        }
      }
      if (S.kb && canAct()) {
        g.strokeStyle = S.look.theme === 'contrast' ? '#ff00ff' : '#fff'; g.lineWidth = 2; g.setLineDash([5, 4]);
        g.strokeRect(sx(L, S.cursor) - c / 2 + 2, sy(L, S.cursor) - c / 2 + 2, c - 4, c - 4); g.setLineDash([]);
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
      S.cursor = i;
      pick(i);
    };
    const onMove = e => {
      const i = sqAt(at(e).x, at(e).y);
      S.kb = false;
      if (i !== S.hover) { S.hover = i; draw(); }
    };
    const onLeave = () => { if (S.hover !== -1) { S.hover = -1; draw(); } };
    const onKey = e => {
      if (!ownsKey(el, e) || dead || S.ended || S.paused || board.isOpen()) return;
      const k = e.key;
      const d = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [1, 0], ArrowDown: [-1, 0] }[k];
      if (d) {
        e.preventDefault(); snd.wake(); S.kb = true;
        const f = flipped() ? -1 : 1;
        const r = Math.max(0, Math.min(7, (S.cursor >> 3) + d[0] * f)), c = Math.max(0, Math.min(7, (S.cursor & 7) + d[1] * f));
        S.cursor = K.sq(r, c);
        draw();
        return;
      }
      if (k === 'Enter' || k === ' ') { if (S.over) return; e.preventDefault(); snd.wake(); S.kb = true; pick(S.cursor); return; }
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
      /* what a watcher may see (./spectate.js): r/R red man/king, c/C cream man/king */
      spectate: () => {
        const first = mode === '2p' ? 'Red' : me === 1 ? 'You' : (mode === 'cpu' ? 'Computer' : peerName);
        const second = mode === '2p' ? 'Cream' : me === -1 ? 'You' : (mode === 'cpu' ? 'Computer' : peerName);
        return { k: 'board', st: 'chk', w: 8, h: 8, cells: K.toRows(S.g.b).join(''), hl: [], txt: statusEl.textContent, over: !!S.over, x: null, turn: S.over ? 0 : S.g.turn,
          pl: [{ n: first, m: 'Red' }, { n: second, m: 'Cream' }] };
      },
      peek: () => {
        const id = v => (v === 1 ? 1 : v === -1 ? 2 : 0);
        const c = K.counts(S.g.b);
        return {
          mode, me: mode === '2p' ? null : id(me), turn: id(S.g.turn), board: K.toRows(S.g.b), counts: c, flipped: flipped(), rules: S.g.rules,
          legal: S.legal.map(m => ({ path: m.path.slice(), caps: m.caps.slice() })), forced: forced(), sel: S.sel, prefix: S.prefix.slice(),
          over: S.over ? { winner: id(S.over.winner), reason: S.over.reason } : null, quiet: S.g.quiet, moves: S.g.moves.map(p => p.map(K.name).join('-')).join(' '),
          level: S.level, vsLevel: S.vsLevel, first: S.first, thinking: S.thinking, worker: !!brain?.worker, rejected: S.rejected, moving: moving(), myMoves: S.myMoves, ended: S.ended,
          paused: S.paused, geo: { ...S.geo }, status: statusEl.textContent, note: S.note, rulesNote: note.textContent, look: { ...S.look },
          hint: S.hint ? { path: S.hint.path.slice(), caps: S.hint.caps.slice() } : null, hints: S.hints, hintBusy: S.hintBusy,
        };
      },
      /* test hook — nothing in the game calls it (and never online): set({ rows, turn: 1|2, quiet }) with rows from the top,
         'r' Red man, 'R' Red king, 'c' Cream man, 'C' Cream king; the rules in play stay */
      hook(cmd, arg) {
        if (cmd !== 'set' || mode === 'online' || !Array.isArray(arg?.rows)) return false;
        brain?.cancel(); clearTimeout(S.endT);
        S.thinkId++; S.hintId++;
        Object.assign(S, { g: K.fromRows(arg.rows, arg.turn === 2 ? -1 : 1, arg.quiet | 0, S.rules), by: [], over: null, anim: null, last: null, thinking: false, myMoves: 0, ended: false, note: '',
          hint: null, hints: 0, hintBusy: false, vsLevel: S.level });
        clearSel();
        refreshLegal();
        const o = K.outcome(S.g);
        if (o.over) { S.over = o; refreshLegal(); finishSoon(); }
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
