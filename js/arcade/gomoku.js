/* ============================================================
   arcade/gomoku.js — Gomoku (five in a row) for Static Arcade.

   A 15 × 15 board; Black and White take turns putting a stone on an
   empty crossing. FREE-STYLE: five or more in an unbroken line —
   across, down or diagonal — wins (an overline of six counts), and
   there are no extra restrictions on Black. A full board is a draw.
   The rules and the computer live in ./gomoku-rules.js.

   · 1P: against the computer (Easy, Medium, Hard), you or the
     computer first; both remembered in portal.arcadeGomoku. The
     search runs in a Web Worker so the page keeps drawing. Undo takes
     back your last stone and its reply.
   · 2P: Black and White take turns on one screen.
   · Online: a friend on another device through the Arcade's room.
     The host is Black (first) in odd rounds, the guest in even ones.
     On your screen your stones are the lighter ones. Every arriving
     move is checked (whose turn, an empty crossing on the board)
     before it reaches the board.

   Mouse or touch: click a crossing. Keyboard: arrow keys move the
   cursor, Enter / Space place a stone, U / Z / Backspace undo.
   Score in 1P: a win scores the stones you placed (fewer is better).
   ============================================================ */
import { h } from '../core/dom.js';
import { store } from '../core/store.js';
import { N, AREA, LEVELS, newGame as freshGame, canPlay, play, undo as unplay, outcome, pointName, fromRows } from './gomoku-rules.js';
import { thinker } from './thinker.js';
import { KIT_CSS, surface, ownsKey, sounder, looper, playerStrip, segment, button, confirmButton, duelLink } from './boardkit.js';

const PREF = 'portal.arcadeGomoku';
const LIGHT = '#f4f1e8', DARK = '#1b1c26';
const MIN_THINK_MS = 320;

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
    /* 1 = Black, who moves first; `me` is my colour's value (2P: none) */
    let me = mode === 'online' ? ((round % 2 === 1) === host ? 1 : -1) : mode === 'cpu' ? (prefs.first === 'cpu' ? -1 : 1) : 0;
    let dead = false;

    const S = {
      g: freshGame(), by: [], over: null, line: null, hover: -1, cursor: 112, kb: false, thinking: false, thinkId: 0,
      level: prefs.level, first: prefs.first, rejected: 0, myMoves: 0, ended: false, endT: 0, geo: { x: 0, y: 0, cell: 0 },
      shake: 0, placed: new Map(), base: null,
    };
    /* my stones are the light ones on my screen; 2P: Black is dark */
    const colorOf = v => (mode === '2p' ? (v === 1 ? DARK : LIGHT) : v === me ? LIGHT : DARK);
    const nameOf = v => (mode === '2p' ? (v === 1 ? 'Black' : 'White') : v === me ? 'You' : mode === 'cpu' ? 'The computer' : peerName);
    const hue = v => (v === 1 ? 'Black' : 'White');

    /* ------------------------------ the page ------------------------------ */
    const boardEl = h('div.arx-bg__board');
    const sr = h('div.arx-bg__sr', { 'aria-live': 'polite' });
    const statusEl = h('div.arx-bg__status', { role: 'status' });
    const topStrip = playerStrip(DARK, '', '');
    const botStrip = playerStrip(LIGHT, '', '');
    const levelSeg = mode === 'cpu' ? segment('Level', [1, 2, 3].map(id => ({ id, label: LEVELS[id].name })), S.level, setLevel) : null;
    const firstSeg = mode === 'cpu' ? segment('First', [{ id: 'me', label: 'You' }, { id: 'cpu', label: 'Computer' }], S.first, setFirst) : null;
    const undoBtn = mode !== 'online' ? button('Undo', 'corner-up-left', () => { undo(); refocus(); }, { title: 'Take back the last move (U)' }) : null;
    const resignBtn = mode !== '2p' ? confirmButton('Resign', 'Resign? Click again', 'x', () => { resign(); refocus(); }) : null;
    const note = h('div.arx-bg__note', {
      text: (mode === 'online' ? 'Your stones are the light ones on your screen. Every move is checked on both screens. '
        : mode === '2p' ? 'Two players on this screen: Black goes first, then take turns. '
          : 'Click a crossing, or use the arrow keys and Enter. ') + 'Free-style: five or more in a row wins; Black has no restrictions.',
    });
    const side = h('div.arx-bg__side', topStrip.el, statusEl, levelSeg?.el, firstSeg?.el, h('div.arx-bg__row', undoBtn, resignBtn), note, botStrip.el);
    const root = h('div.arx-bgc', h('style', { text: KIT_CSS }), h('div.arx-bg', boardEl, side), sr);
    el.appendChild(root);
    const sf = surface(boardEl, 'Gomoku board', () => draw());
    const loop = looper(() => draw());
    const refocus = () => el.closest('[tabindex]')?.focus({ preventScroll: true });

    const link = NET ? duelLink(NET, {
      plies: () => S.g.moves.length,
      mine: i => S.by[i] === 'me',
      wire: i => ({ c: S.g.moves[i] }),
      take: d => {
        if (S.over || S.g.turn !== -me || !canPlay(S.g, d.c)) return false;
        apply(d.c, 'peer');
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
      brain?.cancel();
      clearTimeout(S.endT);
      Object.assign(S, { g: freshGame(), by: [], over: null, line: null, thinking: false, myMoves: 0, ended: false, cursor: 112, placed: new Map(), base: null });
      S.thinkId++;
      ctx.onScore(0);
      NET?.peerScore?.(0);
      paint();
      if (mode === 'cpu' && S.g.turn !== me) computerMove();
    }
    const canAct = () => !dead && !S.over && !S.thinking && (mode === '2p' || S.g.turn === me);

    function tryPlace(i) {
      if (!canAct()) return false;
      if (!canPlay(S.g, i)) {
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
      play(g, i);
      S.by.push(by);
      if (by === 'me') S.myMoves++;
      S.placed.set(i, performance.now());
      loop.kick(reduced ? 0.05 : 0.4);
      snd.blip(v === 1 ? 260 : 340, 0.06, 'triangle', 0.7);
      const o = outcome(g);
      if (o.over) { S.over = o; S.line = o.line; }
      say(`${nameOf(v)} played ${pointName(i)}.${o.over ? ' ' + overText() : ''}`);
      paint();
      if (S.over) {
        if (S.line) { loop.kick(2.5); snd.blip(520, 0.12, 'triangle', 0.8, 780); }
        finishSoon();
      } else if (mode === 'cpu' && g.turn !== me) computerMove();
    }

    async function computerMove() {
      const id = ++S.thinkId;
      S.thinking = true;
      paint();
      const t0 = performance.now();
      const res = await brain.ask({ game: 'gomoku', moves: S.g.moves.slice(), level: S.level, ...(S.base ? { base: S.base } : {}) });
      if (dead || id !== S.thinkId) return;
      const wait = MIN_THINK_MS - (performance.now() - t0);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      if (dead || id !== S.thinkId) return;
      S.thinking = false;
      if (!res || !canPlay(S.g, res.move)) {
        statusEl.textContent = 'The computer could not move. Press Undo or start again.';
        statusEl.classList.add('is-alert');
        return;
      }
      apply(res.move, 'cpu');
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
      S.placed.clear();
      snd.blip(330, 0.07, 'triangle', 0.6, 220);
      say('Move taken back.');
      paint();
    }

    function resign() {
      if (S.over || dead) return;
      if (S.thinking) { brain?.cancel(); S.thinkId++; S.thinking = false; }
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
      const o = S.over, stones = S.g.moves.length;
      if (mode === 'online') {
        const won = o.winner === 0 ? null : o.winner === me;
        const detail = o.reason === 'resign' ? (o.who === 'me' ? 'You resigned.' : `${peerName} resigned.`)
          : o.winner === 0 ? 'The board is full: a draw.' : `Five in a row after ${stones} stones. You played ${me === 1 ? 'Black (first)' : 'White (second)'}.`;
        ctx.onEnd({ score: null, won, versus: { me: won === null ? 0.5 : won ? 1 : 0, them: won === null ? 0.5 : won ? 0 : 1 }, detail });
        return;
      }
      if (mode === '2p') {
        ctx.onEnd({ score: null, detail: o.winner === 0 ? 'The board is full: a draw.' : `${nameOf(o.winner)} wins with five in a row.` });
        return;
      }
      const lv = LEVELS[S.level].name;
      if (o.winner === me) ctx.onEnd({ score: S.myMoves, won: true, detail: `Five in a row with ${S.myMoves} stones against the computer (${lv}).` });
      else if (o.winner === 0) ctx.onEnd({ score: null, won: false, detail: `The board is full: a draw against the computer (${lv}).` });
      else ctx.onEnd({ score: null, won: false, detail: o.reason === 'resign' ? `You resigned against the computer (${lv}).` : `The computer (${lv}) made five in a row.` });
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
      if (o.winner === 0) return 'The board is full: a draw.';
      if (mode === '2p') return `${nameOf(o.winner)} wins!`;
      if (o.reason === 'resign') return o.who === 'me' ? 'You resigned.' : `${peerName} resigned — you win.`;
      return o.winner === me ? 'Five in a row — you win!' : `${mode === 'cpu' ? 'The computer' : peerName} made five in a row.`;
    }
    function say(t) { sr.textContent = t; }

    function paint() {
      if (dead) return;
      const g = S.g;
      let text;
      if (S.over) text = overText();
      else if (mode === 'cpu') text = g.turn === me ? 'Your move' : 'The computer is thinking…';
      else if (mode === '2p') text = `${nameOf(g.turn)} to move`;
      else text = g.turn === me ? 'Your move' : `${peerName}’s move`;
      statusEl.textContent = text;
      statusEl.classList.remove('is-alert');
      statusEl.classList.toggle('is-done', !!S.over);
      const topV = mode === '2p' ? -1 : -me, botV = mode === '2p' ? 1 : me;
      const order = v => (v === 1 ? 'Black, first' : 'White, second');
      topStrip.set({ name: mode === '2p' ? 'White' : mode === 'cpu' ? 'Computer' : peerName, note: mode === 'cpu' ? `${LEVELS[S.level].name} · ${order(topV)}` : order(topV),
        color: colorOf(topV), turn: !S.over && g.turn === topV, thinking: S.thinking });
      botStrip.set({ name: mode === '2p' ? 'Black' : 'You', note: order(botV), color: colorOf(botV), turn: !S.over && g.turn === botV });
      if (undoBtn) undoBtn.disabled = !!S.over || (mode === '2p' ? !g.moves.length : !S.by.includes('me'));
      if (resignBtn) { resignBtn.disabled = !!S.over; if (S.over) resignBtn.reset(); }
      sf.cv.setAttribute('aria-label', `Gomoku board. ${text}`);
      ctx.onScore(mode === '2p' ? g.moves.length : S.myMoves);
      if (NET) NET.peerScore?.(S.by.filter(b => b === 'peer').length);
      draw();
    }

    /* ------------------------------ drawing ------------------------------ */
    function layout() {
      const cell = Math.max(10, Math.floor(Math.min(sf.w, sf.h) / (N + 0.6)));
      return { cell, x: Math.round((sf.w - cell * (N - 1)) / 2), y: Math.round((sf.h - cell * (N - 1)) / 2) };
    }
    const px = (L, i) => L.x + (i % N) * L.cell;
    const py = (L, i) => L.y + ((i / N) | 0) * L.cell;
    const pointAt = (x, y) => {
      const L = S.geo;
      if (!L.cell) return -1;
      const c = Math.round((x - L.x) / L.cell), r = Math.round((y - L.y) / L.cell);
      return c >= 0 && c < N && r >= 0 && r < N ? r * N + c : -1;
    };

    function stone(g, x, y, r, color, alpha = 1) {
      g.save();
      g.globalAlpha = alpha;
      const light = color === LIGHT;
      const gr = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
      gr.addColorStop(0, light ? '#ffffff' : '#5a5d78');
      gr.addColorStop(1, light ? '#cfc9b8' : '#06060b');
      g.shadowColor = 'rgba(0,0,0,.5)';
      g.shadowBlur = r * 0.4;
      g.shadowOffsetY = r * 0.12;
      g.fillStyle = gr;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      g.restore();
    }

    function draw() {
      if (dead) return;
      const g = sf.g;
      sf.begin();
      const L = S.geo = layout();
      const now = performance.now();
      g.fillStyle = '#05060d';
      g.fillRect(0, 0, sf.w, sf.h);
      const span = L.cell * (N - 1), pad = L.cell * 0.7;
      const bg = g.createLinearGradient(L.x, L.y, L.x + span, L.y + span);
      bg.addColorStop(0, '#2c3a63');
      bg.addColorStop(1, '#1b2545');
      g.save();
      g.shadowBlur = 26;
      g.shadowColor = 'hsla(225,90%,60%,.4)';
      g.fillStyle = bg;
      g.fillRect(L.x - pad, L.y - pad, span + pad * 2, span + pad * 2);
      g.restore();
      g.strokeStyle = 'rgba(190,205,255,.5)';
      g.lineWidth = 1;
      g.beginPath();
      for (let k = 0; k < N; k++) {
        g.moveTo(L.x + k * L.cell + 0.5, L.y); g.lineTo(L.x + k * L.cell + 0.5, L.y + span);
        g.moveTo(L.x, L.y + k * L.cell + 0.5); g.lineTo(L.x + span, L.y + k * L.cell + 0.5);
      }
      g.stroke();
      g.fillStyle = 'rgba(200,215,255,.7)';
      for (const [r, c] of [[3, 3], [3, 11], [11, 3], [11, 11], [7, 7]]) { g.beginPath(); g.arc(L.x + c * L.cell, L.y + r * L.cell, Math.max(2, L.cell * 0.09), 0, Math.PI * 2); g.fill(); }
      const R = L.cell * 0.44;
      /* the stones */
      for (let i = 0; i < AREA; i++) {
        const v = S.g.cells[i];
        if (!v) continue;
        const t0 = S.placed.get(i);
        const k = !reduced && t0 ? Math.min(1, (now - t0) / 140) : 1;
        stone(g, px(L, i), py(L, i), R * (0.6 + 0.4 * k), colorOf(v), 0.4 + 0.6 * k);
      }
      /* the last stone */
      const last = S.g.moves[S.g.moves.length - 1];
      if (last !== undefined) {
        g.strokeStyle = '#ff4d6d';
        g.lineWidth = Math.max(2, L.cell * 0.07);
        g.beginPath(); g.arc(px(L, last), py(L, last), R * 0.45, 0, Math.PI * 2); g.stroke();
      }
      /* the winning line */
      if (S.line) {
        const pulse = reduced ? 1 : 0.6 + 0.4 * Math.sin(now / 160);
        g.save();
        g.shadowBlur = 16; g.shadowColor = '#ffd23f';
        g.strokeStyle = `rgba(255,210,63,${pulse})`;
        g.lineWidth = Math.max(2, L.cell * 0.09);
        for (const i of S.line) { g.beginPath(); g.arc(px(L, i), py(L, i), R * 1.04, 0, Math.PI * 2); g.stroke(); }
        g.restore();
      }
      /* the stone waiting under the pointer / the keyboard cursor */
      const at = S.kb ? S.cursor : S.hover;
      if (at >= 0 && canAct()) {
        if (canPlay(S.g, at)) stone(g, px(L, at), py(L, at), R, colorOf(S.g.turn), 0.45);
        if (S.kb) {
          g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 2; g.setLineDash([4, 4]);
          g.strokeRect(px(L, at) - L.cell * 0.5, py(L, at) - L.cell * 0.5, L.cell, L.cell);
          g.setLineDash([]);
        }
      }
      if (S.shake && now - S.shake < 220 && at >= 0) {
        g.strokeStyle = `rgba(255,90,110,${1 - (now - S.shake) / 220})`; g.lineWidth = 3;
        g.beginPath(); g.arc(px(L, at), py(L, at), R, 0, Math.PI * 2); g.stroke();
      }
    }

    /* ------------------------------ input ------------------------------ */
    const at = e => { const r = sf.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const onDown = e => {
      if (e.button > 0 || dead) return;
      snd.wake();
      S.kb = false;
      const p = at(e), i = pointAt(p.x, p.y);
      if (i < 0) return;
      S.hover = i;
      tryPlace(i);
    };
    const onMove = e => {
      const p = at(e), i = pointAt(p.x, p.y);
      S.kb = false;
      if (i !== S.hover) { S.hover = i; sf.cv.style.cursor = i >= 0 && canAct() && canPlay(S.g, i) ? 'pointer' : 'default'; draw(); }
    };
    const onLeave = () => { if (S.hover !== -1) { S.hover = -1; draw(); } };
    const onKey = e => {
      if (!ownsKey(el, e) || dead || S.ended) return;
      const k = e.key;
      const d = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[k];
      if (d) {
        e.preventDefault();
        snd.wake();
        S.kb = true;
        const r = Math.max(0, Math.min(N - 1, ((S.cursor / N) | 0) + d[0])), c = Math.max(0, Math.min(N - 1, (S.cursor % N) + d[1]));
        S.cursor = r * N + c;
        draw();
        return;
      }
      if (k === 'Enter' || k === ' ') { e.preventDefault(); snd.wake(); S.kb = true; tryPlace(S.cursor); return; }
      if ((k === 'u' || k === 'U' || k === 'z' || k === 'Z' || k === 'Backspace') && mode !== 'online') { e.preventDefault(); undo(); }
    };
    window.addEventListener('keydown', onKey);
    sf.cv.addEventListener('pointerdown', onDown);
    sf.cv.addEventListener('pointermove', onMove);
    sf.cv.addEventListener('pointerleave', onLeave);

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
        sf.cv.removeEventListener('pointerleave', onLeave);
        resignBtn?.reset();
        snd.close();
        sf.destroy();
        root.remove();
      },
      /* test hook (inert unless a test calls it): 'setup' loads a position { rows, turn } to play on from */
      hook(cmd, arg) {
        if (cmd !== 'setup') return false;
        brain?.cancel();
        S.thinkId++;
        clearTimeout(S.endT);
        S.g = fromRows(arg.rows, arg.turn || 1);
        Object.assign(S, { by: [], over: null, line: null, thinking: false, myMoves: 0, ended: false, placed: new Map(), base: { cells: Array.from(S.g.cells), turn: S.g.turn } });
        paint();
        if (mode === 'cpu' && S.g.turn !== me) computerMove();
        return true;
      },
      /* what a watcher may see (./spectate.js): B = black (moves first), W = white */
      spectate: () => ({
        k: 'board', st: 'gomoku', w: N, h: N, cells: Array.from(S.g.cells, v => (v === 1 ? 'B' : v === -1 ? 'W' : '.')).join(''),
        hl: [], txt: statusEl.textContent, over: !!S.over, turn: S.over ? 0 : S.g.turn,
        pl: [{ n: nameOf(1), m: 'Black' }, { n: nameOf(-1), m: 'White' }],
      }),
      peek: () => {
        const id = v => (v === 1 ? 1 : v === -1 ? 2 : 0);
        const rows = [];
        for (let r = 0; r < N; r++) { let s = ''; for (let c = 0; c < N; c++) { const v = S.g.cells[r * N + c]; s += v === 1 ? 'x' : v === -1 ? 'o' : '.'; } rows.push(s); }
        return {
          mode, me: mode === '2p' ? null : id(me), turn: id(S.g.turn), rows, moves: S.g.moves.slice(), count: S.g.count,
          over: S.over ? { winner: id(S.over.winner), reason: S.over.reason || 'five' } : null, line: S.line,
          level: S.level, first: S.first, thinking: S.thinking, worker: !!brain?.worker, rejected: S.rejected, cursor: S.cursor,
          myMoves: S.myMoves, ended: S.ended, geo: { ...S.geo }, status: statusEl.textContent, hue: hue(S.g.turn),
        };
      },
    };
  },
};
