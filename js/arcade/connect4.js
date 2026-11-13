/* ============================================================
   arcade/connect4.js — Connect Four for Static Arcade.

   A 7 × 6 board; drop a disc into a column and it falls to the
   lowest free hole. Four in a row — across, down or diagonal — wins,
   and the winning line lights up.

   · 1P: against the computer (Easy, Medium, Hard — minimax with
     alpha-beta in ./c4-rules.js, run in a Web Worker so the page
     keeps drawing), you or the computer first; both remembered in
     portal.arcadeConnect4. Undo takes back your last disc and its
     reply.
   · 2P: Yellow and Red take turns on one screen.
   · Online: a friend on another device through the Arcade's room.
     The host goes first in odd rounds, the guest in even ones. On
     your screen your discs are always yellow and your strip is at
     the bottom. Every arriving move is checked (whose turn, a real
     column with room) before it reaches the board.

   Mouse or touch: point at a column and click. Keyboard: ← → pick a
   column, Enter / Space / ↓ drop, 1–7 drop straight into a column,
   U / Z / Backspace undo. Score in 1P: a win scores the number of
   discs it took (fewer is better).
   ============================================================ */
import { h } from '../core/dom.js';
import { store } from '../core/store.js';
import { COLS, ROWS, newGame as freshGame, canPlay, play, undo as unplay, outcome, LEVELS } from './c4-rules.js';
import { thinker } from './thinker.js';
import { KIT_CSS, surface, ownsKey, sounder, looper, rr, playerStrip, segment, button, confirmButton, duelLink } from './boardkit.js';

const PREF = 'portal.arcadeConnect4';
const YELLOW = '#ffd23f', RED = '#ff4d6d';
const MIN_THINK_MS = 380;

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
    /* 1 = whoever moves first; me is the value of my discs (2P: none) */
    let me = mode === 'online' ? ((round % 2 === 1) === host ? 1 : -1) : mode === 'cpu' ? (prefs.first === 'cpu' ? -1 : 1) : 0;
    let dead = false;

    const S = {
      g: freshGame(1), by: [], over: null, line: null, drops: [], hover: -1, cursor: 3, kb: false,
      thinking: false, thinkId: 0, level: prefs.level, first: prefs.first, rejected: 0, myMoves: 0,
      ended: false, endT: 0, geo: { x: 0, y: 0, cell: 0 }, shake: 0,
    };
    const colorOf = v => (mode === '2p' ? (v === 1 ? YELLOW : RED) : v === me ? YELLOW : RED);
    const nameOf = v => (mode === '2p' ? (v === 1 ? 'Yellow' : 'Red') : v === me ? 'You' : mode === 'cpu' ? 'The computer' : peerName);

    /* ------------------------------ the page ------------------------------ */
    const boardEl = h('div.arx-bg__board');
    const sr = h('div.arx-bg__sr', { 'aria-live': 'polite' });
    const statusEl = h('div.arx-bg__status', { role: 'status' });
    const topStrip = playerStrip(RED, '', '');
    const botStrip = playerStrip(YELLOW, '', '');
    const levelSeg = mode === 'cpu' ? segment('Level', [1, 2, 3].map(id => ({ id, label: LEVELS[id].name })), S.level, setLevel) : null;
    const firstSeg = mode === 'cpu' ? segment('First', [{ id: 'me', label: 'You' }, { id: 'cpu', label: 'Computer' }], S.first, setFirst) : null;
    const undoBtn = mode !== 'online' ? button('Undo', 'corner-up-left', () => { undo(); refocus(); }, { title: 'Take back the last move (U)' }) : null;
    const resignBtn = mode !== '2p' ? confirmButton('Resign', 'Resign? Click again', 'x', () => { resign(); refocus(); }) : null;
    const note = h('div.arx-bg__note', {
      text: mode === 'online' ? 'Your discs are yellow on your screen. Every move is checked on both screens.'
        : mode === '2p' ? 'Two players on this screen: Yellow goes first, then take turns.'
          : 'Point at a column and click, or use ← → and Enter. 1–7 drop straight in.',
    });
    const side = h('div.arx-bg__side', topStrip.el, statusEl, levelSeg?.el, firstSeg?.el, h('div.arx-bg__row', undoBtn, resignBtn), note, botStrip.el);
    const root = h('div.arx-bgc', h('style', { text: KIT_CSS }), h('div.arx-bg', boardEl, side), sr);
    el.appendChild(root);
    const sf = surface(boardEl, 'Connect Four board', () => draw());
    const loop = looper(() => draw());
    const refocus = () => el.closest('[tabindex]')?.focus({ preventScroll: true });

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
        paint();
        finishSoon();
      },
      dead: () => dead,
    }) : null;

    /* ------------------------------ rules glue ------------------------------ */
    function newGame() {
      brain?.cancel();
      clearTimeout(S.endT);
      Object.assign(S, { g: freshGame(1), by: [], over: null, line: null, drops: [], thinking: false, myMoves: 0, ended: false, cursor: 3 });
      S.thinkId++;
      ctx.onScore(0);
      NET?.peerScore?.(0);
      paint();
      if (mode === 'cpu' && S.g.turn !== me) computerMove();
    }
    const falling = () => S.drops.some(d => performance.now() - d.t0 < d.dur);
    const canAct = () => !dead && !S.over && !S.thinking && (mode === '2p' || S.g.turn === me);

    function tryDrop(col) {
      if (!canAct()) return false;
      if (!canPlay(S.g, col)) {
        S.shake = performance.now();
        snd.blip(140, 0.08, 'sawtooth', 0.4);
        loop.kick(0.25);
        return false;
      }
      apply(col, 'me');
      link?.sendMove(S.g.moves.length - 1);
      return true;
    }

    function apply(col, by) {
      const g = S.g;
      const v = g.turn;
      const row = play(g, col);
      S.by.push(by);
      if (by === 'me') S.myMoves++;
      const fall = ROWS - row;
      const dur = reduced ? 0 : Math.round(120 + 70 * Math.sqrt(fall));
      S.drops = S.drops.filter(d => performance.now() - d.t0 < d.dur);
      S.drops.push({ col, row, v, t0: performance.now(), dur });
      loop.kick(dur / 1000 + 0.05);
      snd.blip(300 + row * 40, 0.06, 'triangle', 0.7);
      const o = outcome(g);
      if (o.over) { S.over = o; S.line = o.line; }
      say(`${nameOf(v)} dropped in column ${col + 1}.${o.over ? ' ' + overText() : ''}`);
      paint();
      if (S.over) {
        if (S.line) loop.kick(2.5);
        finishSoon(dur);
      } else if (mode === 'cpu' && g.turn !== me) computerMove(dur);
    }

    async function computerMove(waitFall = 0) {
      const id = ++S.thinkId;
      S.thinking = true;
      paint();
      const t0 = performance.now();
      const g = S.g;
      const res = await brain.ask({ game: 'c4', cells: Array.from(g.cells), h: Array.from(g.h), turn: g.turn, moves: g.moves.slice(), level: S.level });
      if (dead || id !== S.thinkId) return;
      const wait = Math.max(MIN_THINK_MS, waitFall + 80) - (performance.now() - t0);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      if (dead || id !== S.thinkId) return;
      S.thinking = false;
      if (!res || !canPlay(S.g, res.col)) {
        statusEl.textContent = 'The computer could not move. Press Undo or start again.';
        statusEl.classList.add('is-alert');
        return;
      }
      apply(res.col, 'cpu');
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
      S.drops = [];
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
        ctx.onEnd({ score: null, detail: o.winner === 0 ? 'The board is full: a draw.' : `${nameOf(o.winner)} wins with four in a row.` });
        return;
      }
      const lv = LEVELS[S.level].name;
      if (o.winner === me) ctx.onEnd({ score: S.myMoves, won: true, detail: `Four in a row with ${S.myMoves} discs against the computer (${lv}).` });
      else if (o.winner === 0) ctx.onEnd({ score: null, won: false, detail: `The board is full: a draw against the computer (${lv}).` });
      else ctx.onEnd({ score: null, won: false, detail: o.reason === 'resign' ? `You resigned against the computer (${lv}).` : `The computer (${lv}) made four in a row.` });
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
      return o.winner === me ? 'Four in a row — you win!' : `${mode === 'cpu' ? 'The computer' : peerName} made four in a row.`;
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
      const order = v => (v === 1 ? 'first' : 'second');
      topStrip.set({ name: mode === '2p' ? 'Red' : mode === 'cpu' ? 'Computer' : peerName, note: mode === 'cpu' ? `${LEVELS[S.level].name} · goes ${order(topV)}` : `Goes ${order(topV)}`,
        color: colorOf(topV), turn: !S.over && g.turn === topV, thinking: S.thinking });
      botStrip.set({ name: mode === '2p' ? 'Yellow' : 'You', note: `Goes ${order(botV)}`, color: colorOf(botV), turn: !S.over && g.turn === botV });
      if (undoBtn) undoBtn.disabled = !!S.over || (mode === '2p' ? !g.moves.length : !S.by.includes('me'));
      if (resignBtn) { resignBtn.disabled = !!S.over; if (S.over) resignBtn.reset(); }
      sf.cv.setAttribute('aria-label', `Connect Four board. ${text}`);
      ctx.onScore(mode === '2p' ? g.moves.length : S.myMoves);
      if (NET) NET.peerScore?.(S.by.filter(b => b === 'peer').length);
      draw();
    }

    /* ------------------------------ drawing ------------------------------ */
    function layout() {
      const cell = Math.max(16, Math.floor(Math.min(sf.w / (COLS + 0.4), sf.h / (ROWS + 1.5))));
      const x = Math.round((sf.w - cell * COLS) / 2);
      const y = Math.round((sf.h - cell * (ROWS + 1)) / 2 + cell * 1.05);
      return { cell, x, y };
    }
    const cx = (L, c) => L.x + (c + 0.5) * L.cell;
    const cy = (L, r) => L.y + (ROWS - 1 - r + 0.5) * L.cell;       /* r: 0 = bottom */
    const colAt = x => { const L = S.geo; const c = Math.floor((x - L.x) / L.cell); return c >= 0 && c < COLS ? c : -1; };

    function disc(g, x, y, r, color, alpha = 1) {
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
      const glow = g.createRadialGradient(sf.w / 2, sf.h * 0.6, 0, sf.w / 2, sf.h * 0.6, Math.max(sf.w, sf.h) * 0.6);
      glow.addColorStop(0, 'hsla(220,90%,45%,.2)');
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = glow;
      g.fillRect(0, 0, sf.w, sf.h);
      const R = L.cell * 0.4;
      /* the disc waiting above the column */
      const col = S.kb ? S.cursor : S.hover;
      if (col >= 0 && canAct() && !falling()) {
        const v = S.g.turn;
        disc(g, cx(L, col), L.y - L.cell * 0.55, R, colorOf(v), canPlay(S.g, col) ? 0.9 : 0.25);
      }
      /* discs (behind the board) */
      const drops = new Map();
      for (const d of S.drops) if (now - d.t0 < d.dur) drops.set(d.row * COLS + d.col, d);
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const v = S.g.cells[r * COLS + c];
        if (!v || drops.has(r * COLS + c)) continue;
        disc(g, cx(L, c), cy(L, r), R, colorOf(v));
      }
      for (const d of drops.values()) {
        const k = Math.min(1, (now - d.t0) / d.dur);
        const y0 = L.y - L.cell * 0.55, y1 = cy(L, d.row);
        disc(g, cx(L, d.col), y0 + (y1 - y0) * k * k, R, colorOf(d.v));
      }
      /* the board, with its holes */
      let sx = 0;
      if (S.shake && now - S.shake < 200) sx = Math.sin((now - S.shake) / 18) * 4 * (1 - (now - S.shake) / 200);
      g.save();
      g.translate(sx, 0);
      g.shadowBlur = 26;
      g.shadowColor = 'hsla(220,100%,55%,.55)';
      const bg = g.createLinearGradient(0, L.y, 0, L.y + ROWS * L.cell);
      bg.addColorStop(0, '#2a5cff');
      bg.addColorStop(1, '#1532a8');
      g.fillStyle = bg;
      g.beginPath();
      rr(g, L.x - L.cell * 0.12, L.y - L.cell * 0.08, L.cell * (COLS + 0.24), L.cell * (ROWS + 0.16), L.cell * 0.22);
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        g.moveTo(cx(L, c) + R + 1, cy(L, r));
        g.arc(cx(L, c), cy(L, r), R + 1, 0, Math.PI * 2, true);
      }
      g.fill('evenodd');
      g.restore();
      g.strokeStyle = 'rgba(160,190,255,.35)';
      g.lineWidth = 1.5;
      rr(g, L.x - L.cell * 0.12 + sx, L.y - L.cell * 0.08, L.cell * (COLS + 0.24), L.cell * (ROWS + 0.16), L.cell * 0.22);
      g.stroke();
      /* the winning line */
      if (S.line && !falling()) {
        const pulse = reduced ? 1 : 0.65 + 0.35 * Math.sin(now / 160);
        g.save();
        g.shadowBlur = 18;
        g.shadowColor = '#ffffff';
        g.strokeStyle = `rgba(255,255,255,${pulse})`;
        g.lineWidth = Math.max(2, L.cell * 0.08);
        for (const [r, c] of S.line) { g.beginPath(); g.arc(cx(L, c), cy(L, r), R * 0.98, 0, Math.PI * 2); g.stroke(); }
        g.restore();
      }
      /* the keyboard's column */
      if (S.kb && canAct()) {
        g.strokeStyle = 'rgba(255,255,255,.55)';
        g.lineWidth = 2;
        g.setLineDash([5, 5]);
        g.strokeRect(L.x + S.cursor * L.cell + 3, L.y - L.cell * 1.05, L.cell - 6, L.cell * (ROWS + 1.05));
        g.setLineDash([]);
      }
    }

    /* ------------------------------ input ------------------------------ */
    const at = e => { const r = sf.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const onDown = e => {
      if (e.button > 0 || dead) return;
      snd.wake();
      S.kb = false;
      const c = colAt(at(e).x);
      if (c < 0) return;
      S.hover = c;
      tryDrop(c);
    };
    const onMove = e => {
      const c = colAt(at(e).x);
      if (S.kb) { S.kb = false; }
      if (c !== S.hover) { S.hover = c; sf.cv.style.cursor = c >= 0 && canAct() ? 'pointer' : 'default'; draw(); }
    };
    const onLeave = () => { if (S.hover !== -1) { S.hover = -1; draw(); } };
    const onKey = e => {
      if (!ownsKey(el, e) || dead || S.ended) return;
      const k = e.key;
      if (k === 'ArrowLeft' || k === 'ArrowRight') {
        e.preventDefault();
        snd.wake();
        S.kb = true;
        S.cursor = Math.max(0, Math.min(COLS - 1, S.cursor + (k === 'ArrowLeft' ? -1 : 1)));
        draw();
        return;
      }
      if (k === 'Enter' || k === ' ' || k === 'ArrowDown') { e.preventDefault(); snd.wake(); S.kb = true; tryDrop(S.cursor); return; }
      if (/^[1-7]$/.test(k)) { e.preventDefault(); snd.wake(); S.cursor = Number(k) - 1; S.kb = true; tryDrop(S.cursor); return; }
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
      /* what a watcher may see (./spectate.js): the board top row first, '1' = the first mover */
      spectate: () => {
        const rows = [];
        for (let r = ROWS - 1; r >= 0; r--) { let s = ''; for (let c = 0; c < COLS; c++) { const v = S.g.cells[r * COLS + c]; s += v === 1 ? '1' : v === -1 ? '2' : '.'; } rows.push(s); }
        const first = mode === '2p' ? 'Yellow' : me === 1 ? 'You' : (mode === 'cpu' ? 'Computer' : peerName);
        const second = mode === '2p' ? 'Red' : me === -1 ? 'You' : (mode === 'cpu' ? 'Computer' : peerName);
        return { k: 'board', st: 'c4', w: COLS, h: ROWS, cells: rows.join(''), hl: [], txt: statusEl.textContent, over: !!S.over, x: null, turn: S.over ? 0 : S.g.turn,
          pl: [{ n: first, m: 'Yellow' }, { n: second, m: 'Red' }] };
      },
      peek: () => {
        const grid = [];
        for (let r = ROWS - 1; r >= 0; r--) {
          let s = '';
          for (let c = 0; c < COLS; c++) { const v = S.g.cells[r * COLS + c]; s += v === 1 ? '1' : v === -1 ? '2' : '.'; }
          grid.push(s);
        }
        const id = v => (v === 1 ? 1 : v === -1 ? 2 : 0);
        return {
          mode, me: mode === '2p' ? null : id(me), turn: id(S.g.turn), grid, moves: S.g.moves.join(''),
          over: S.over ? { winner: id(S.over.winner), reason: S.over.reason || 'four' } : null, line: S.line,
          level: S.level, first: S.first, thinking: S.thinking, worker: !!brain?.worker, rejected: S.rejected,
          dropping: falling(), cursor: S.cursor, myMoves: S.myMoves, ended: S.ended, geo: { ...S.geo }, status: statusEl.textContent,
        };
      },
    };
  },
};

/* a darker edge for a disc colour (#rrggbb) */
function shade(hex) {
  const n = parseInt(hex.slice(1), 16);
  const f = v => Math.round(v * 0.55).toString(16).padStart(2, '0');
  return `#${f(n >> 16)}${f((n >> 8) & 255)}${f(n & 255)}`;
}
