/* ============================================================
   arcade/ttt.js — Tic-Tac-Toe for Static Arcade.

   Classic 3 × 3, and Ultimate: nine small boards in one big one,
   where the square you play in picks the small board your opponent
   must play in next (rules and computer in ./ttt-rules.js).

   · 1P: against the computer (Easy, Medium, Hard — Hard is perfect
     minimax on the 3 × 3 board and never loses), you or the
     computer first; Classic or Ultimate. Level, first and board are
     remembered in portal.arcadeTtt. The search runs in a Web Worker.
     Undo takes back your move and its reply.
   · 2P: X and O take turns on one screen.
   · Online: a friend on another device through the Arcade's room.
     Classic 3 × 3 only. The host is X (moves first) in odd rounds,
     the guest in even ones; on your screen you are always blue.
     Every arriving move is checked (whose turn, an empty square)
     before it reaches the board; anything else is ignored.

   Mouse or touch: click a square. Keyboard: arrow keys move the
   cursor, Enter / Space place a mark, 1–9 place straight into a
   classic square (like a phone's keypad: 1 top left, 9 bottom
   right), U / Z / Backspace undo.
   Score in 1P Classic: a win scores the marks it took (fewer is
   better); Ultimate wins don't score.
   ============================================================ */
import { h } from '../core/dom.js';
import { store } from '../core/store.js';
import * as T from './ttt-rules.js';
import { thinker } from './thinker.js';
import { KIT_CSS, surface, ownsKey, sounder, looper, playerStrip, segment, button, confirmButton, duelLink } from './boardkit.js';

const PREF = 'portal.arcadeTtt';
const BLUE = '#4dd2ff', PINK = '#ff4d6d';
const MIN_THINK_MS = 340;

const readPrefs = () => {
  let p = null;
  try { p = store.get(PREF, null); } catch (err) { p = null; }
  return { level: [1, 2, 3].includes(p?.level) ? p.level : 2, first: p?.first === 'cpu' ? 'cpu' : 'me', ult: !!p?.ult };
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
    /* 1 = X, who moves first; `me` is my mark's value (2P: none) */
    let me = mode === 'online' ? ((round % 2 === 1) === host ? 1 : -1) : mode === 'cpu' ? (prefs.first === 'cpu' ? -1 : 1) : 0;
    let dead = false;

    const S = {
      ult: mode === 'online' ? false : prefs.ult, g: T.newGame(false), by: [], over: null, hover: -1, cursor: 4, kb: false, thinking: false, thinkId: 0,
      level: prefs.level, first: prefs.first, rejected: 0, myMoves: 0, ended: false, endT: 0, geo: { x: 0, y: 0, size: 0 }, shake: 0, placed: new Map(),
    };
    const name = v => (v === 1 ? 'X' : 'O');
    const colorOf = v => (mode === '2p' ? (v === 1 ? BLUE : PINK) : v === me ? BLUE : PINK);
    const nameOf = v => (mode === '2p' ? `Player ${name(v)}` : v === me ? 'You' : mode === 'cpu' ? 'The computer' : peerName);

    /* ------------------------------ the page ------------------------------ */
    const boardEl = h('div.arx-bg__board');
    const sr = h('div.arx-bg__sr', { 'aria-live': 'polite' });
    const statusEl = h('div.arx-bg__status', { role: 'status' });
    const topStrip = playerStrip(PINK, '', '');
    const botStrip = playerStrip(BLUE, '', '');
    const levelSeg = mode === 'cpu' ? segment('Level', [1, 2, 3].map(id => ({ id, label: T.LEVELS[id].name })), S.level, setLevel) : null;
    const firstSeg = mode === 'cpu' ? segment('First', [{ id: 'me', label: 'You' }, { id: 'cpu', label: 'Computer' }], S.first, setFirst) : null;
    const boardSeg = mode !== 'online' ? segment('Board', [{ id: 'c', label: 'Classic 3×3' }, { id: 'u', label: 'Ultimate 9×9' }], S.ult ? 'u' : 'c', setBoard) : null;
    const undoBtn = mode !== 'online' ? button('Undo', 'corner-up-left', () => { undo(); refocus(); }, { title: 'Take back the last move (U)' }) : null;
    const resignBtn = mode !== '2p' ? confirmButton('Resign', 'Resign? Click again', 'x', () => { resign(); refocus(); }) : null;
    const note = h('div.arx-bg__note', {
      text: mode === 'online' ? 'Classic 3×3. You are blue on your screen. Every move is checked on both screens.'
        : mode === '2p' ? 'Two players on this screen: X goes first, then take turns.'
          : 'Click a square, or use the arrow keys and Enter. 1–9 play a classic square straight away.',
    });
    const side = h('div.arx-bg__side', topStrip.el, statusEl, boardSeg?.el, levelSeg?.el, firstSeg?.el, h('div.arx-bg__row', undoBtn, resignBtn), note, botStrip.el);
    const root = h('div.arx-bgc', h('style', { text: KIT_CSS }), h('div.arx-bg', boardEl, side), sr);
    el.appendChild(root);
    const sf = surface(boardEl, 'Tic-Tac-Toe board', () => draw());
    const loop = looper(() => draw());
    const refocus = () => el.closest('[tabindex]')?.focus({ preventScroll: true });

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
        paint();
        finishSoon();
      },
      dead: () => dead,
    }) : null;

    /* ------------------------------ rules glue ------------------------------ */
    function newGame() {
      brain?.cancel();
      clearTimeout(S.endT);
      Object.assign(S, { g: T.newGame(S.ult), by: [], over: null, thinking: false, myMoves: 0, ended: false, cursor: S.ult ? 40 : 4, placed: new Map() });
      S.thinkId++;
      ctx.onScore(0);
      NET?.peerScore?.(0);
      paint();
      if (mode === 'cpu' && S.g.turn !== me) computerMove();
    }
    const canAct = () => !dead && !S.over && !S.thinking && (mode === '2p' || S.g.turn === me);

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
      T.play(g, i);
      S.by.push(by);
      if (by === 'me') S.myMoves++;
      S.placed.set(i, performance.now());
      loop.kick(reduced ? 0.05 : 0.4);
      snd.blip(v === 1 ? 420 : 330, 0.06, 'triangle', 0.7);
      const o = T.outcome(g);
      if (o.over) S.over = o;
      say(`${nameOf(v)} played ${cellName(i)}.${o.over ? ' ' + overText() : ''}`);
      paint();
      if (S.over) { loop.kick(2.5); finishSoon(); }
      else if (mode === 'cpu' && g.turn !== me) computerMove();
    }
    const cellName = i => (S.ult ? `row ${Math.floor(i / 9) + 1}, column ${(i % 9) + 1}` : `square ${i + 1}`);

    async function computerMove() {
      const id = ++S.thinkId;
      S.thinking = true;
      paint();
      const t0 = performance.now();
      const res = await brain.ask({ game: 'ttt', ult: S.ult, moves: S.g.moves.slice(), level: S.level });
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
      S.placed = new Map();
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
      const lv = T.LEVELS[S.level].name, kind = S.ult ? 'Ultimate' : 'Classic';
      if (o.winner === me) ctx.onEnd({ score: S.ult ? null : marks, won: true, detail: `You won ${kind} against the computer (${lv})${S.ult ? '' : ` with ${marks} marks`}.` });
      else if (o.winner === 0) ctx.onEnd({ score: null, won: false, detail: `A draw in ${kind} against the computer (${lv}).` });
      else ctx.onEnd({ score: null, won: false, detail: o.reason === 'resign' ? `You resigned against the computer (${lv}).` : `The computer (${lv}) won ${kind}.` });
    }

    function setLevel(v) { S.level = v; writePrefs({ level: v }); levelSeg.set(v); paint(); refocus(); }
    function setFirst(v) {
      S.first = v; writePrefs({ first: v }); firstSeg.set(v);
      me = v === 'cpu' ? -1 : 1;
      newGame(); refocus();
    }
    function setBoard(v) {
      S.ult = v === 'u'; writePrefs({ ult: S.ult }); boardSeg.set(v);
      newGame(); refocus();
    }

    /* ------------------------------ text ------------------------------ */
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
      const where = S.ult ? (g.next === -1 ? ' — play in any open board' : ` — play in the highlighted board`) : '';
      if (mode === 'cpu') return g.turn === me ? `Your move (${name(g.turn)})${where}` : 'The computer is thinking…';
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
      sf.cv.setAttribute('aria-label', `${S.ult ? 'Ultimate ' : ''}Tic-Tac-Toe board. ${text}`);
      ctx.onScore(mode === '2p' ? g.moves.length : S.myMoves);
      if (NET) NET.peerScore?.(S.by.filter(b => b === 'peer').length);
      draw();
    }

    /* ------------------------------ drawing ------------------------------ */
    const N = () => (S.ult ? 9 : 3);
    function layout() {
      const size = Math.max(60, Math.floor(Math.min(sf.w, sf.h) * 0.94));
      return { size, x: Math.round((sf.w - size) / 2), y: Math.round((sf.h - size) / 2) };
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
      g.shadowColor = color;
      g.shadowBlur = r * 0.5;
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
      const n = N(), cell = L.size / n, now = performance.now();
      g.fillStyle = '#05060d';
      g.fillRect(0, 0, sf.w, sf.h);
      const glow = g.createRadialGradient(sf.w / 2, sf.h / 2, 0, sf.w / 2, sf.h / 2, Math.max(sf.w, sf.h) * 0.6);
      glow.addColorStop(0, 'hsla(190,90%,45%,.16)');
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = glow; g.fillRect(0, 0, sf.w, sf.h);
      /* the small board to play in (Ultimate) */
      if (S.ult && !S.over) {
        const live = S.g.next === -1 ? [0, 1, 2, 3, 4, 5, 6, 7, 8].filter(s => S.g.sub[s] === 0) : [S.g.next];
        g.fillStyle = canAct() ? 'rgba(255,255,255,.1)' : 'rgba(255,255,255,.04)';
        for (const s of live) g.fillRect(L.x + (s % 3) * L.size / 3, L.y + Math.floor(s / 3) * L.size / 3, L.size / 3, L.size / 3);
      }
      /* hover / cursor ghost */
      const hv = S.kb ? S.cursor : S.hover;
      if (hv >= 0 && canAct()) {
        const r = Math.floor(hv / n), c = hv % n;
        const okc = T.canPlay(S.g, hv);
        if (okc) mark(g, S.g.turn, L.x + (c + 0.5) * cell, L.y + (r + 0.5) * cell, cell * 0.3, colorOf(S.g.turn), 0.35);
        if (S.kb) { g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 2; g.setLineDash([4, 4]); g.strokeRect(L.x + c * cell + 3, L.y + r * cell + 3, cell - 6, cell - 6); g.setLineDash([]); }
      }
      /* grid */
      g.lineCap = 'round';
      for (let i = 1; i < n; i++) {
        const big = !S.ult || i % 3 === 0;
        g.strokeStyle = big ? 'rgba(160,200,255,.8)' : 'rgba(160,200,255,.28)';
        g.lineWidth = big ? Math.max(2, L.size * 0.012) : 1;
        g.beginPath(); g.moveTo(L.x + i * cell, L.y + (big ? 0 : 0)); g.lineTo(L.x + i * cell, L.y + L.size); g.stroke();
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
          const cx = L.x + ((s % 3) + 0.5) * L.size / 3, cy = L.y + (Math.floor(s / 3) + 0.5) * L.size / 3;
          if (v === 1 || v === -1) mark(g, v, cx, cy, L.size / 3 * 0.34, colorOf(v), 0.95);
          else if (v === 2) { g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(cx - L.size / 6 + 2, cy - L.size / 6 + 2, L.size / 3 - 4, L.size / 3 - 4); }
        }
      }
      /* the winning line */
      if (win) {
        const pulse = reduced ? 1 : 0.65 + 0.35 * Math.sin(now / 160);
        g.save();
        g.strokeStyle = `rgba(255,255,255,${pulse})`;
        g.shadowColor = '#fff'; g.shadowBlur = 16;
        g.lineWidth = Math.max(3, L.size * 0.016);
        const pt = k => S.ult
          ? [L.x + ((k % 3) + 0.5) * L.size / 3, L.y + (Math.floor(k / 3) + 0.5) * L.size / 3]
          : [L.x + ((k % 3) + 0.5) * cell, L.y + (Math.floor(k / 3) + 0.5) * cell];
        const a = pt(win[0]), b = pt(win[2]);
        g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
        g.restore();
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
      if (!ownsKey(el, e) || dead || S.ended) return;
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
      if ((k === 'u' || k === 'U' || k === 'z' || k === 'Z' || k === 'Backspace') && mode !== 'online') { e.preventDefault(); undo(); }
    };
    window.addEventListener('keydown', onKey);
    sf.cv.addEventListener('pointerdown', onDown);
    sf.cv.addEventListener('pointermove', onMove);
    sf.cv.addEventListener('pointerleave', onLeave);

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
        level: S.level, first: S.first, thinking: S.thinking, worker: !!brain?.worker, rejected: S.rejected, myMoves: S.myMoves, ended: S.ended,
        cursor: S.cursor, geo: { ...S.geo }, status: statusEl.textContent,
      }),
    };
  },
};
