/* ============================================================
   arcade/reversi.js — Reversi (Othello rules) for Static Arcade.

   An 8 × 8 board. Place a disc so that it brackets a straight line of
   the other colour's discs against one of yours: every bracketed disc
   flips. Black moves first. A player with no legal move passes (the game
   says so and does it); when neither can move, or the board is full, the
   side with more discs wins. Squares you may play are marked.

   · 1P: against the computer (Easy, Medium, Hard: alpha-beta search with
     corners and mobility in ./reversi-rules.js, run in a Web Worker so the
     page keeps drawing), you or the computer first; remembered in
     portal.arcadeReversi. Undo takes back your last move and the replies.
     A win scores your disc count (more is better).
   · 2P: Black and White take turns on one screen.
   · Online: a friend on another device through the Arcade's room. The host
     is Black in odd rounds, White in even ones. Every arriving move is
     checked with the rules (whose turn, a legal square) before it reaches
     the board.

   Mouse or touch: click or tap a marked square. Keyboard: arrows move the
   cursor, Enter / Space place, U / Z / Backspace undo. Flips turn over
   (a squash and swap); with reduced motion they are instant. Pause hides
   the board and stops the computer.
   ============================================================ */
import { h } from '../core/dom.js';
import { store } from '../core/store.js';
import * as R from './reversi-rules.js';
import { thinker } from './thinker.js';
import { KIT_CSS, surface, ownsKey, sounder, looper, rr, playerStrip, segment, button, confirmButton, duelLink } from './boardkit.js';

const PREF = 'portal.arcadeReversi';
const MIN_THINK_MS = 420;
const FLIP_MS = 380;
const DARK = '#1c1d26', LIGHT = '#f4f1ea';

const readPrefs = () => {
  let p = null;
  try { p = store.get(PREF, null); } catch (err) { p = null; }
  return { level: [1, 2, 3].includes(p?.level) ? p.level : 2, first: p?.first === 'cpu' ? 'cpu' : 'me' };
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
    /* me is the value of my discs: 1 Black (first), -1 White */
    let me = mode === 'online' ? ((round % 2 === 1) === host ? 1 : -1) : mode === 'cpu' ? (prefs.first === 'cpu' ? -1 : 1) : 0;
    let dead = false;

    const S = {
      g: R.newGame(), by: [], over: null, anim: [], last: -1, hover: -1, cursor: 19, kb: false, legal: [], note: '',
      thinking: false, thinkId: 0, level: prefs.level, first: prefs.first, rejected: 0, myMoves: 0, paused: false,
      ended: false, endT: 0, geo: { x: 0, y: 0, cell: 0 }, shake: 0,
    };
    const colorOf = v => (v === 1 ? DARK : LIGHT);
    const nameOf = v => (mode === '2p' ? (v === 1 ? 'Black' : 'White') : v === me ? 'You' : mode === 'cpu' ? 'The computer' : peerName);

    /* ------------------------------ the page ------------------------------ */
    const boardEl = h('div.arx-bg__board');
    const sr = h('div.arx-bg__sr', { 'aria-live': 'polite' });
    const statusEl = h('div.arx-bg__status', { role: 'status' });
    const topStrip = playerStrip(LIGHT, '', '');
    const botStrip = playerStrip(DARK, '', '');
    const levelSeg = mode === 'cpu' ? segment('Level', [1, 2, 3].map(id => ({ id, label: R.LEVELS[id].name })), S.level, setLevel) : null;
    const firstSeg = mode === 'cpu' ? segment('First', [{ id: 'me', label: 'You' }, { id: 'cpu', label: 'Computer' }], S.first, setFirst) : null;
    const undoBtn = mode !== 'online' ? button('Undo', 'corner-up-left', () => { undo(); refocus(); }, { title: 'Take back the last move (U)' }) : null;
    const resignBtn = mode !== '2p' ? confirmButton('Resign', 'Resign? Click again', 'x', () => { resign(); refocus(); }) : null;
    const note = h('div.arx-bg__note', {
      text: mode === 'online' ? 'Dots mark where you may play. Every move is checked on both screens. If a side has no move it passes.'
        : mode === '2p' ? 'Two players on this screen: Black goes first. A side with no legal move passes.'
          : 'Click a dotted square, or use the arrows and Enter. A side with no legal move passes.',
    });
    const side = h('div.arx-bg__side', topStrip.el, statusEl, levelSeg?.el, firstSeg?.el, h('div.arx-bg__row', undoBtn, resignBtn), note, botStrip.el);
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

    function newGame() {
      brain?.cancel();
      clearTimeout(S.endT);
      Object.assign(S, { g: R.newGame(), by: [], over: null, anim: [], last: -1, thinking: false, myMoves: 0, ended: false, note: '', cursor: 19 });
      S.thinkId++;
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
        return false;
      }
      apply(i, 'me');
      link?.sendMove(S.g.moves.length - 1);
      return true;
    }

    function apply(i, by) {
      const g = S.g;
      const v = g.turn;
      const r = R.play(g, i);
      S.by.push(by);
      if (by === 'me') S.myMoves++;
      S.last = i;
      const now = performance.now();
      S.anim = S.anim.filter(a => now - a.t0 < a.dur + a.delay);
      const ri = i >> 3, ci = i & 7;
      S.anim.push({ i, v, t0: now, dur: reduced ? 0 : 200, delay: 0, kind: 'drop' });
      r.flips.forEach(s => {
        const d = Math.max(Math.abs((s >> 3) - ri), Math.abs((s & 7) - ci));
        S.anim.push({ i: s, v, t0: now, dur: reduced ? 0 : FLIP_MS, delay: reduced ? 0 : 120 + d * 70, kind: 'flip' });
      });
      const settle = reduced ? 0 : 200 + 70 * 7 + FLIP_MS;
      loop.kick(settle / 1000 + 0.1);
      snd.blip(340 + r.flips.length * 25, 0.06, 'triangle', 0.8);
      const o = R.outcome(g);
      S.note = r.passed && !o.over ? `${nameOf(r.passed)} ${r.passed === me && mode !== '2p' ? 'have' : 'has'} no legal move and pass${r.passed === me && mode !== '2p' ? '' : 'es'}.` : '';
      if (o.over) S.over = o;
      refreshLegal();
      say(`${nameOf(v)} played ${'abcdefgh'[ci]}${ri + 1} and flipped ${r.flips.length}. ${S.note} ${S.over ? overText() : ''}`);
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

    function undo() {
      if (mode === 'online' || S.over || dead || S.paused) return;
      const g = S.g;
      if (mode === '2p') {
        if (!g.moves.length) return;
        R.undo(g); S.by.pop();
      } else {
        const mine = S.by.lastIndexOf('me');
        if (mine < 0) return;
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
      if (o.winner === me) ctx.onEnd({ score: mineN, won: true, detail: `You won ${mineN} discs to ${theirN} against the computer (${lv}).` });
      else if (o.winner === 0) ctx.onEnd({ score: null, won: false, detail: `A draw, ${mineN} discs each, against the computer (${lv}).` });
      else ctx.onEnd({ score: null, won: false, detail: o.reason === 'resign' ? `You resigned against the computer (${lv}).` : `The computer (${lv}) won ${theirN} discs to ${mineN}.` });
    }

    function setLevel(v) { S.level = v; writePrefs({ level: v }); levelSeg.set(v); paint(); refocus(); }
    function setFirst(v) {
      S.first = v;
      writePrefs({ first: v });
      firstSeg.set(v);
      me = v === 'cpu' ? -1 : 1;
      newGame();
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
      sf.cv.setAttribute('aria-label', `Reversi board. Black ${black}, White ${white}. ${text}`);
      ctx.onScore(mode === '2p' ? black + white : me === 1 ? black : me === -1 ? white : black);
      if (NET) NET.peerScore?.(me === 1 ? white : black);
      draw();
    }

    /* ------------------------------ drawing ------------------------------ */
    function layout() {
      const cell = Math.max(14, Math.floor(Math.min(sf.w, sf.h) / 8.7));
      return { cell, x: Math.round((sf.w - cell * 8) / 2), y: Math.round((sf.h - cell * 8) / 2) };
    }
    const cx = (L, i) => L.x + ((i & 7) + 0.5) * L.cell;
    const cy = (L, i) => L.y + ((i >> 3) + 0.5) * L.cell;
    const sqAt = (x, y) => {
      const L = S.geo, c = Math.floor((x - L.x) / L.cell), r = Math.floor((y - L.y) / L.cell);
      return c >= 0 && c < 8 && r >= 0 && r < 8 ? r * 8 + c : -1;
    };
    function disc(g, x, y, r, v, sx = 1) {
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
      g.strokeStyle = dk ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.18)'; g.lineWidth = Math.max(1, r * 0.08);
      g.beginPath(); g.arc(0, 0, r * 0.72, 0, Math.PI * 2); g.stroke();
      g.restore();
    }

    function draw() {
      if (dead) return;
      const g = sf.g;
      sf.begin();
      const L = S.geo = layout();
      const now = performance.now(), c = L.cell, R0 = c * 0.41;
      g.fillStyle = '#05060d'; g.fillRect(0, 0, sf.w, sf.h);
      if (S.paused) {
        g.fillStyle = 'rgba(255,255,255,.8)'; g.textAlign = 'center'; g.font = `700 ${Math.round(c * 0.6)}px Inter,system-ui,sans-serif`;
        g.fillText('Paused', sf.w / 2, sf.h / 2);
        return;
      }
      let sx = 0;
      if (S.shake && now - S.shake < 200) sx = Math.sin((now - S.shake) / 18) * 4 * (1 - (now - S.shake) / 200);
      g.save(); g.translate(sx, 0);
      g.shadowBlur = 24; g.shadowColor = 'rgba(40,200,120,.35)';
      const bg = g.createLinearGradient(0, L.y, 0, L.y + c * 8);
      bg.addColorStop(0, '#1f8a58'); bg.addColorStop(1, '#136b43');
      g.fillStyle = bg;
      rr(g, L.x - c * 0.12, L.y - c * 0.12, c * 8.24, c * 8.24, c * 0.2); g.fill();
      g.shadowBlur = 0;
      g.strokeStyle = 'rgba(0,0,0,.32)'; g.lineWidth = 1.5;
      for (let k = 0; k <= 8; k++) {
        g.beginPath(); g.moveTo(L.x + k * c, L.y); g.lineTo(L.x + k * c, L.y + 8 * c); g.moveTo(L.x, L.y + k * c); g.lineTo(L.x + 8 * c, L.y + k * c); g.stroke();
      }
      g.fillStyle = 'rgba(0,0,0,.4)';
      for (const [a, b] of [[2, 2], [6, 2], [2, 6], [6, 6]]) { g.beginPath(); g.arc(L.x + a * c, L.y + b * c, c * 0.06, 0, Math.PI * 2); g.fill(); }
      /* the last move */
      if (S.last >= 0) {
        g.strokeStyle = 'rgba(255,224,102,.85)'; g.lineWidth = 2.5;
        rr(g, L.x + (S.last & 7) * c + 2, L.y + (S.last >> 3) * c + 2, c - 4, c - 4, c * 0.12); g.stroke();
      }
      /* discs */
      const anims = new Map();
      for (const a of S.anim) if (now - a.t0 < a.dur + a.delay) anims.set(a.i, a);
      for (let i = 0; i < 64; i++) {
        const v = S.g.b[i];
        if (!v) continue;
        const a = anims.get(i);
        if (!a) { disc(g, cx(L, i), cy(L, i), R0, v); continue; }
        const k = Math.max(0, Math.min(1, (now - a.t0 - a.delay) / Math.max(1, a.dur)));
        if (a.kind === 'drop') disc(g, cx(L, i), cy(L, i), R0 * (0.3 + 0.7 * k), v);
        else {
          const before = now - a.t0 < a.delay;
          const sc = before ? 1 : Math.abs(Math.cos(Math.PI * k));
          disc(g, cx(L, i), cy(L, i), R0, before || k < 0.5 ? -a.v : a.v, sc);
        }
      }
      g.restore();
      /* where you may play */
      if (canAct() && !flipping()) {
        const hl = S.kb ? S.cursor : S.hover;
        const v = S.g.turn;
        for (const i of S.legal) {
          if (i === hl) { g.globalAlpha = 0.55; disc(g, cx(L, i), cy(L, i), R0, v); g.globalAlpha = 1; continue; }
          g.fillStyle = v === 1 ? 'rgba(10,10,20,.55)' : 'rgba(255,255,255,.65)';
          g.beginPath(); g.arc(cx(L, i), cy(L, i), c * 0.11, 0, Math.PI * 2); g.fill();
        }
        if (S.kb) {
          g.strokeStyle = '#fff'; g.lineWidth = 2; g.setLineDash([5, 4]);
          g.strokeRect(L.x + (S.cursor & 7) * c + 3, L.y + (S.cursor >> 3) * c + 3, c - 6, c - 6); g.setLineDash([]);
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
      if (i !== S.hover) { S.hover = i; sf.cv.style.cursor = i >= 0 && canAct() && S.legal.includes(i) ? 'pointer' : 'default'; draw(); }
    };
    const onLeave = () => { if (S.hover !== -1) { S.hover = -1; draw(); } };
    const onKey = e => {
      if (!ownsKey(el, e) || dead || S.ended || S.paused) return;
      const k = e.key;
      const d = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[k];
      if (d) {
        e.preventDefault(); snd.wake(); S.kb = true;
        const r = Math.max(0, Math.min(7, (S.cursor >> 3) + d[0])), c = Math.max(0, Math.min(7, (S.cursor & 7) + d[1]));
        S.cursor = r * 8 + c;
        draw();
        return;
      }
      if (k === 'Enter' || k === ' ') { if (S.over) return; e.preventDefault(); snd.wake(); S.kb = true; tryPlace(S.cursor); return; }
      if ((k === 'u' || k === 'U' || k === 'z' || k === 'Z' || k === 'Backspace') && mode !== 'online') { e.preventDefault(); undo(); }
    };
    window.addEventListener('keydown', onKey);
    sf.cv.addEventListener('pointerdown', onDown);
    sf.cv.addEventListener('pointermove', onMove);
    sf.cv.addEventListener('pointerleave', onLeave);

    newGame();

    const api = {
      stop() {
        dead = true;
        clearTimeout(S.endT);
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
        return { k: 'board', st: 'rev', w: 8, h: 8, cells: R.toRows(S.g.b).join('').replace(/X/g, 'B').replace(/O/g, 'W'), hl: [], txt: statusEl.textContent, over: !!S.over, x: null, turn: S.over ? 0 : S.g.turn,
          pl: [{ n: first, m: `Black ${black}` }, { n: second, m: `White ${white}` }] };
      },
      peek: () => {
        const { black, white } = R.count(S.g.b);
        const id = v => (v === 1 ? 1 : v === -1 ? 2 : 0);
        return {
          mode, me: mode === '2p' ? null : id(me), turn: id(S.g.turn), board: R.toRows(S.g.b), black, white, legal: S.legal.slice(), moves: S.g.moves.join(','),
          over: S.over ? { winner: id(S.over.winner), reason: S.over.reason || 'full' } : null, note: S.note, level: S.level, first: S.first, thinking: S.thinking,
          worker: !!brain?.worker, rejected: S.rejected, flipping: flipping(), myMoves: S.myMoves, ended: S.ended, paused: S.paused, geo: { ...S.geo }, status: statusEl.textContent,
        };
      },
      /* test hook — nothing in the game calls it (and never online): set({ rows: ['X..',…], turn: 1|2 }) plays on from that position */
      hook(cmd, arg) {
        if (cmd !== 'set' || mode === 'online' || !Array.isArray(arg?.rows)) return false;
        brain?.cancel(); clearTimeout(S.endT);
        S.thinkId++;
        Object.assign(S, { g: R.fromString(arg.rows, arg.turn === 2 ? -1 : 1), by: [], over: null, anim: [], last: -1, thinking: false, myMoves: 0, ended: false, note: '' });
        refreshLegal();
        paint();
        return true;
      },
    };
    if (mode !== 'online') {
      api.pause = () => {
        if (S.paused) return;
        S.paused = true;
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
