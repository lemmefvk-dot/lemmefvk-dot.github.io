/* ============================================================
   arcade/hexclaim.js — Hex Claim for Static Arcade.

   Claim hexagons, one a turn, and join your two edges with an
   unbroken chain. Orange (moves first) joins TOP to BOTTOM, Blue
   joins LEFT to RIGHT; the coloured edges of the board say which is
   which. Somebody always gets across, so there is no draw. The
   rules and the computer are in ./hexclaim-rules.js.

   · 1P: against the computer (Easy, Medium, Hard), you or the
     computer first, on a 7×7, 9×9 or 11×11 board — all remembered
     in portal.arcadeHexclaim. The computer thinks on this page
     (a moment, never long). Undo takes back your last claim and
     its reply. A win scores the hexagons you claimed (fewer is
     better); a board other than 9×9 doesn't set a best.
   · 2P: Orange and Blue take turns on one screen.
   · Online: a friend on another device through the Arcade's room,
     on 9×9. The host is Orange (first) in odd rounds. On your
     screen you are always the colour at the bottom of the side
     panel. Every arriving move is checked (whose turn, an empty
     hexagon on the board) before it reaches the board.

   Mouse or touch: click a hexagon. Keyboard: arrow keys move the
   cursor, Enter / Space claim, U / Z / Backspace undo.
   ============================================================ */
import { h } from '../core/dom.js';
import { store } from '../core/store.js';
import { SIZES, LEVELS, newGame as freshGame, canPlay, play, undo as unplay, outcome, fromRows, bestMove, pointName } from './hexclaim-rules.js';
import { KIT_CSS, surface, ownsKey, sounder, looper, playerStrip, segment, button, confirmButton, duelLink } from './boardkit.js';

const PREF = 'portal.arcadeHexclaim';
const ORANGE = '#ffa62b', BLUE = '#38a8ff';
const MIN_THINK_MS = 350;
const ONLINE_N = 9;
const SQ3 = Math.sqrt(3);

const readPrefs = () => {
  let p = null;
  try { p = store.get(PREF, null); } catch (err) { p = null; }
  return { level: [1, 2, 3].includes(p?.level) ? p.level : 2, first: p?.first === 'cpu' ? 'cpu' : 'me', n: SIZES.includes(p?.n) ? p.n : 9 };
};
const writePrefs = patch => { try { store.set(PREF, { ...readPrefs(), ...patch }); } catch (err) { /* a convenience */ } };

export default {
  mount(el, ctx) {
    const NET = ctx.online && typeof ctx.online.send === 'function' ? ctx.online : null;
    const mode = NET ? 'online' : ctx.players === 2 ? '2p' : 'cpu';
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    const prefs = readPrefs();
    const host = NET?.role === 'host';
    const round = Number.isInteger(NET?.round) ? NET.round : 1;
    const peerName = String(NET?.peer?.name || 'Friend');
    /* 1 = Orange, who moves first and joins top to bottom; `me` is my side's value (2P: none) */
    let me = mode === 'online' ? ((round % 2 === 1) === host ? 1 : -1) : mode === 'cpu' ? (prefs.first === 'cpu' ? -1 : 1) : 0;
    let dead = false, paused = false, thinkTimer = 0;
    const N0 = mode === 'online' ? ONLINE_N : prefs.n;

    const S = {
      g: freshGame(N0), by: [], over: null, line: null, hover: -1, cursor: 0, kb: false, thinking: false, thinkId: 0,
      level: prefs.level, first: prefs.first, rejected: 0, myMoves: 0, ended: false, endT: 0, geo: { cx: [], cy: [], s: 0 },
      shake: 0, placed: new Map(),
    };
    S.cursor = (N0 >> 1) * N0 + (N0 >> 1);
    const sideName = v => (v === 1 ? 'Orange' : 'Blue');
    const colorOf = v => (v === 1 ? ORANGE : BLUE);
    const nameOf = v => (mode === '2p' ? sideName(v) : v === me ? 'You' : mode === 'cpu' ? 'The computer' : peerName);
    const goal = v => (v === 1 ? 'top to bottom' : 'left to right');

    /* ------------------------------ the page ------------------------------ */
    const boardEl = h('div.arx-bg__board');
    const sr = h('div.arx-bg__sr', { 'aria-live': 'polite' });
    const statusEl = h('div.arx-bg__status', { role: 'status' });
    const topStrip = playerStrip(BLUE, '', '');
    const botStrip = playerStrip(ORANGE, '', '');
    const levelSeg = mode === 'cpu' ? segment('Level', [1, 2, 3].map(id => ({ id, label: LEVELS[id].name })), S.level, setLevel) : null;
    const firstSeg = mode === 'cpu' ? segment('First', [{ id: 'me', label: 'You' }, { id: 'cpu', label: 'Computer' }], S.first, setFirst) : null;
    const sizeSeg = mode !== 'online' ? segment('Board', SIZES.map(id => ({ id, label: `${id}×${id}` })), N0, setSize) : null;
    const undoBtn = mode !== 'online' ? button('Undo', 'corner-up-left', () => { undo(); refocus(); }, { title: 'Take back the last move (U)' }) : null;
    const resignBtn = mode !== '2p' ? confirmButton('Resign', 'Resign? Click again', 'x', () => { resign(); refocus(); }) : null;
    const note = h('div.arx-bg__note', {
      text: (mode === 'online' ? 'Every move is checked on both screens. '
        : mode === '2p' ? 'Two players on this screen: Orange goes first, then take turns. '
          : 'Click a hexagon, or use the arrow keys and Enter. ') + 'Orange joins the top and bottom edges, Blue the left and right. There is no draw.',
    });
    const side = h('div.arx-bg__side', topStrip.el, statusEl, levelSeg?.el, firstSeg?.el, sizeSeg?.el, h('div.arx-bg__row', undoBtn, resignBtn), note, botStrip.el);
    const root = h('div.arx-bgc', h('style', { text: KIT_CSS }), h('div.arx-bg', boardEl, side), sr);
    el.appendChild(root);
    const sf = surface(boardEl, 'Hex Claim board', () => draw());
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
        ctx.announce?.(`${peerName} resigned.`);
        paint();
        finishSoon();
      },
      dead: () => dead,
    }) : null;

    /* ------------------------------ rules glue ------------------------------ */
    function newGame(n = S.g.n) {
      clearTimeout(thinkTimer);
      clearTimeout(S.endT);
      S.thinkId++;
      Object.assign(S, { g: freshGame(n), by: [], over: null, line: null, thinking: false, myMoves: 0, ended: false, placed: new Map(), cursor: (n >> 1) * n + (n >> 1) });
      ctx.onScore(0);
      NET?.peerScore?.(0);
      paint();
      if (mode === 'cpu' && S.g.turn !== me) computerMove();
    }
    const canAct = () => !dead && !paused && !S.over && !S.thinking && (mode === '2p' || S.g.turn === me);

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
      snd.blip(v === 1 ? 300 : 380, 0.06, 'triangle', 0.7);
      if (g.over) { S.over = g.over; S.line = g.over.line; }
      const told = `${nameOf(v)} claimed ${pointName(g.n, i)}.${S.over ? ' ' + overText() : ''}`;
      say(told);
      if (by !== 'me' || mode === '2p') ctx.announce?.(told);
      paint();
      if (S.over) {
        loop.kick(reduced ? 0.05 : 2.5);
        snd.blip(520, 0.12, 'triangle', 0.8, 780);
        finishSoon();
      } else if (mode === 'cpu' && g.turn !== me) computerMove();
    }

    function computerMove() {
      const id = ++S.thinkId;
      S.thinking = true;
      paint();
      const t0 = performance.now();
      /* let the "thinking" state paint before the search takes the thread */
      thinkTimer = setTimeout(() => {
        if (dead || id !== S.thinkId) return;
        let mv = -1;
        try { mv = bestMove(S.g, S.level); } catch (err) { console.error('[hexclaim]', err); }
        const wait = MIN_THINK_MS - (performance.now() - t0);
        thinkTimer = setTimeout(() => {
          if (dead || id !== S.thinkId) return;
          S.thinking = false;
          if (paused) { S.pending = mv; return; }
          if (!canPlay(S.g, mv)) {
            statusEl.textContent = 'The computer could not move. Press Undo or start again.';
            statusEl.classList.add('is-alert');
            return;
          }
          apply(mv, 'cpu');
        }, Math.max(0, wait));
      }, 40);
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
        if (S.thinking) { clearTimeout(thinkTimer); S.thinkId++; S.thinking = false; }
        while (g.moves.length > mine) { unplay(g); if (S.by.pop() === 'me') S.myMoves--; }
        g.turn = me;
      }
      S.placed.clear();
      snd.blip(330, 0.07, 'triangle', 0.6, 220);
      say('Move taken back.');
      paint();
    }

    function resign() {
      if (S.over || dead) return;
      if (S.thinking) { clearTimeout(thinkTimer); S.thinkId++; S.thinking = false; }
      S.over = { over: true, winner: -me, reason: 'resign', who: 'me' };
      link?.resign();
      say('You resigned.');
      paint();
      finishSoon();
    }

    function finishSoon() {
      clearTimeout(S.endT);
      S.endT = setTimeout(finish, reduced ? 300 : 1000);
    }
    function finish() {
      if (S.ended || dead || !S.over) return;
      S.ended = true;
      paint();
      const o = S.over, n = S.g.n, claims = S.g.moves.length;
      if (mode === 'online') {
        const won = o.winner === me;
        const detail = o.reason === 'resign' ? (o.who === 'me' ? 'You resigned.' : `${peerName} resigned.`)
          : `${won ? 'You joined' : `${peerName} joined`} ${o.winner === 1 ? 'top to bottom' : 'left to right'} after ${claims} claims. You played ${me === 1 ? 'Orange (first)' : 'Blue (second)'}.`;
        ctx.onEnd({ score: null, won, versus: { me: won ? 1 : 0, them: won ? 0 : 1 }, detail });
        return;
      }
      if (mode === '2p') {
        ctx.onEnd({ score: null, detail: `${sideName(o.winner)} wins: joined ${goal(o.winner)}.` });
        return;
      }
      const lv = LEVELS[S.level].name, key = `${n}-${S.level}`, label = `${n}×${n} · ${lv}`;
      const won = o.winner === me;
      const extra = { vs: { key, label, result: won ? 'win' : 'loss' }, ...(n !== 9 ? { assisted: 'Only a 9×9 board sets a best' } : {}) };
      if (won) ctx.onEnd({ score: S.myMoves, won: true, detail: `Joined ${goal(me)} with ${S.myMoves} hexagons against the computer (${label}).`, ...extra });
      else ctx.onEnd({ score: null, won: false, detail: o.reason === 'resign' ? `You resigned against the computer (${label}).` : `The computer (${label}) joined ${goal(-me)}.`, ...extra });
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
    function setSize(n) {
      writePrefs({ n });
      sizeSeg.set(n);
      newGame(n);
      refocus();
    }

    /* ------------------------------ text ------------------------------ */
    function overText() {
      const o = S.over;
      if (!o) return '';
      if (mode === '2p') return `${sideName(o.winner)} wins: joined ${goal(o.winner)}.`;
      if (o.reason === 'resign') return o.who === 'me' ? 'You resigned.' : `${peerName} resigned — you win.`;
      return o.winner === me ? 'Chain complete — you win!' : `${mode === 'cpu' ? 'The computer' : peerName} joined ${goal(o.winner)}.`;
    }
    function say(t) { sr.textContent = t; }

    function paint() {
      if (dead) return;
      const g = S.g;
      let text;
      if (S.over) text = overText();
      else if (mode === 'cpu') text = g.turn === me ? `Your move: join ${goal(me)}` : 'The computer is thinking…';
      else if (mode === '2p') text = `${sideName(g.turn)} to move: ${goal(g.turn)}`;
      else text = g.turn === me ? `Your move: join ${goal(me)}` : `${peerName}’s move`;
      statusEl.textContent = text;
      statusEl.classList.remove('is-alert');
      statusEl.classList.toggle('is-done', !!S.over);
      const topV = mode === '2p' ? -1 : -me, botV = mode === '2p' ? 1 : me;
      const order = v => `${sideName(v)} · ${goal(v)}`;
      topStrip.set({ name: mode === '2p' ? 'Blue' : mode === 'cpu' ? 'Computer' : peerName, note: mode === 'cpu' ? `${LEVELS[S.level].name} · ${order(topV)}` : order(topV),
        color: colorOf(topV), turn: !S.over && g.turn === topV, thinking: S.thinking });
      botStrip.set({ name: mode === '2p' ? 'Orange' : 'You', note: order(botV), color: colorOf(botV), turn: !S.over && g.turn === botV });
      if (undoBtn) undoBtn.disabled = !!S.over || (mode === '2p' ? !g.moves.length : !S.by.includes('me'));
      if (resignBtn) { resignBtn.disabled = !!S.over; if (S.over) resignBtn.reset(); }
      sf.cv.setAttribute('aria-label', `Hex Claim board, ${g.n} by ${g.n}. ${text}`);
      ctx.onScore(mode === '2p' ? g.moves.length : S.myMoves);
      if (NET) NET.peerScore?.(S.by.filter(b => b === 'peer').length);
      draw();
    }

    /* ------------------------------ drawing ------------------------------ */
    function layout() {
      const n = S.g.n;
      const wUnits = (n + (n - 1) / 2) * SQ3 + 1.2, hUnits = (n - 1) * 1.5 + 2 + 1.2;
      const s = Math.max(6, Math.min(sf.w / wUnits, sf.h / hUnits));
      const ox = (sf.w - (n + (n - 1) / 2) * SQ3 * s) / 2 + (SQ3 * s) / 2, oy = (sf.h - ((n - 1) * 1.5 + 2) * s) / 2 + s;
      const cx = [], cy = [];
      for (let i = 0; i < n * n; i++) { const r = (i / n) | 0, c = i % n; cx.push(ox + (c + r / 2) * SQ3 * s); cy.push(oy + r * 1.5 * s); }
      return { s, cx, cy };
    }
    const verts = (x, y, s) => {
      const out = [];
      for (let k = 0; k < 6; k++) { const a = (Math.PI / 180) * (-90 + 60 * k); out.push([x + Math.cos(a) * s, y + Math.sin(a) * s]); }
      return out;
    };
    const pointAt = (x, y) => {
      const L = S.geo;
      if (!L.s) return -1;
      let best = -1, bd = (L.s * 0.88) ** 2;
      for (let i = 0; i < L.cx.length; i++) { const d = (L.cx[i] - x) ** 2 + (L.cy[i] - y) ** 2; if (d < bd) { bd = d; best = i; } }
      return best;
    };

    function stone(g, x, y, r, v, alpha = 1) {
      g.save();
      g.globalAlpha = alpha;
      const gr = g.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
      gr.addColorStop(0, v === 1 ? '#ffd596' : '#a9dcff');
      gr.addColorStop(1, v === 1 ? '#d97c00' : '#1676c9');
      g.fillStyle = gr;
      g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = r * 0.35; g.shadowOffsetY = r * 0.1;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      g.shadowColor = 'transparent';
      /* a mark besides the colour: a dot on Orange, a ring on Blue */
      g.fillStyle = g.strokeStyle = 'rgba(10,14,28,.7)';
      g.lineWidth = Math.max(1.5, r * 0.16);
      g.beginPath();
      if (v === 1) { g.arc(x, y, r * 0.2, 0, Math.PI * 2); g.fill(); } else { g.arc(x, y, r * 0.42, 0, Math.PI * 2); g.stroke(); }
      g.restore();
    }

    function draw() {
      if (dead) return;
      const g = sf.g, G = S.g, n = G.n;
      sf.begin();
      const L = S.geo = layout();
      const now = performance.now();
      g.fillStyle = '#05060d';
      g.fillRect(0, 0, sf.w, sf.h);
      /* the cells */
      const lineSet = new Set(S.line || []);
      for (let i = 0; i < n * n; i++) {
        const vs = verts(L.cx[i], L.cy[i], L.s * 0.97);
        g.beginPath(); vs.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath();
        g.fillStyle = (i + ((i / n) | 0)) % 2 ? '#232c4d' : '#1f2748';
        g.fill();
        g.strokeStyle = 'rgba(160,180,255,.35)'; g.lineWidth = 1; g.stroke();
      }
      /* the edges: Blue on the left and right, Orange on top and bottom */
      g.lineCap = 'round';
      g.lineWidth = Math.max(3, L.s * 0.16);
      const edge = (i, a, b, color) => { const vs = verts(L.cx[i], L.cy[i], L.s * 1.02); g.strokeStyle = color; g.beginPath(); g.moveTo(vs[a][0], vs[a][1]); g.lineTo(vs[b][0], vs[b][1]); g.stroke(); };
      for (let k = 0; k < n; k++) {
        const left = k * n, right = k * n + n - 1;
        edge(left, 4, 5, BLUE); edge(left, 3, 4, BLUE); edge(right, 1, 2, BLUE); edge(right, 0, 1, BLUE);
      }
      for (let k = 0; k < n; k++) {
        const top = k, bottom = (n - 1) * n + k;
        edge(top, 5, 0, ORANGE); edge(top, 0, 1, ORANGE); edge(bottom, 2, 3, ORANGE); edge(bottom, 3, 4, ORANGE);
      }
      /* the stones */
      const R = L.s * 0.72;
      for (let i = 0; i < n * n; i++) {
        const v = G.cells[i];
        if (!v) continue;
        const t0 = S.placed.get(i);
        const k = !reduced && t0 ? Math.min(1, (now - t0) / 140) : 1;
        stone(g, L.cx[i], L.cy[i], R * (0.6 + 0.4 * k), v, 0.4 + 0.6 * k);
      }
      const last = G.moves[G.moves.length - 1];
      if (last !== undefined) {
        g.strokeStyle = '#ffffff'; g.lineWidth = Math.max(2, L.s * 0.07);
        g.beginPath(); g.arc(L.cx[last], L.cy[last], R * 0.5, 0, Math.PI * 2); g.stroke();
      }
      /* the winning chain */
      if (S.line) {
        const pulse = reduced ? 1 : 0.65 + 0.35 * Math.sin(now / 160);
        g.save();
        g.shadowBlur = 14; g.shadowColor = '#ffd23f';
        g.strokeStyle = `rgba(255,236,150,${pulse})`;
        g.lineWidth = Math.max(3, L.s * 0.14);
        g.beginPath();
        S.line.forEach((i, k) => (k ? g.lineTo(L.cx[i], L.cy[i]) : g.moveTo(L.cx[i], L.cy[i])));
        g.stroke();
        g.restore();
      }
      const at = S.kb ? S.cursor : S.hover;
      if (at >= 0 && canAct()) {
        if (canPlay(G, at)) stone(g, L.cx[at], L.cy[at], R, G.turn, 0.42);
        if (S.kb) {
          const vs = verts(L.cx[at], L.cy[at], L.s * 0.98);
          g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 2; g.setLineDash([4, 4]);
          g.beginPath(); vs.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.stroke();
          g.setLineDash([]);
        }
      }
      if (S.shake && now - S.shake < 220 && at >= 0) {
        g.strokeStyle = `rgba(255,90,110,${1 - (now - S.shake) / 220})`; g.lineWidth = 3;
        g.beginPath(); g.arc(L.cx[at], L.cy[at], R, 0, Math.PI * 2); g.stroke();
      }
      if (paused) {
        g.fillStyle = 'rgba(6,8,16,.7)'; g.fillRect(0, 0, sf.w, sf.h);
        g.fillStyle = '#fff'; g.font = '800 28px Inter,system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('Paused', sf.w / 2, sf.h / 2);
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
      if (!ownsKey(el, e) || dead || paused || S.ended) return;
      const k = e.key, n = S.g.n;
      const d = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[k];
      if (d) {
        e.preventDefault();
        snd.wake();
        S.kb = true;
        const r = Math.max(0, Math.min(n - 1, ((S.cursor / n) | 0) + d[0])), c = Math.max(0, Math.min(n - 1, (S.cursor % n) + d[1]));
        S.cursor = r * n + c;
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

    newGame(N0);

    return {
      stop() {
        dead = true;
        clearTimeout(S.endT); clearTimeout(thinkTimer);
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
      pause() { if (dead || paused) return; paused = true; draw(); },
      resume() {
        if (dead || !paused) return;
        paused = false;
        if (S.pending !== undefined) { const mv = S.pending; S.pending = undefined; if (!S.over && canPlay(S.g, mv)) apply(mv, 'cpu'); }
        draw();
      },
      /* test hook (inert unless a test calls it): 'setup' loads a position { rows, turn } to play on from */
      hook(cmd, arg) {
        if (cmd !== 'setup') return false;
        clearTimeout(thinkTimer);
        S.thinkId++;
        clearTimeout(S.endT);
        S.g = fromRows(arg.rows, arg.turn || 1);
        Object.assign(S, { by: [], over: S.g.over || null, line: S.g.over?.line || null, thinking: false, myMoves: 0, ended: false, placed: new Map(), cursor: 0 });
        paint();
        if (mode === 'cpu' && S.g.turn !== me && !S.over) computerMove();
        return true;
      },
      peek: () => {
        const id = v => (v === 1 ? 1 : v === -1 ? 2 : 0), n = S.g.n;
        const rows = [];
        for (let r = 0; r < n; r++) { let s = ''; for (let c = 0; c < n; c++) { const v = S.g.cells[r * n + c]; s += v === 1 ? 'x' : v === -1 ? 'o' : '.'; } rows.push(s); }
        return {
          mode, n, me: mode === '2p' ? null : id(me), turn: id(S.g.turn), rows, moves: S.g.moves.slice(), count: S.g.count,
          over: S.over ? { winner: id(S.over.winner), reason: S.over.reason || 'chain' } : null, line: S.line,
          level: S.level, first: S.first, thinking: S.thinking, rejected: S.rejected, cursor: S.cursor, paused,
          myMoves: S.myMoves, ended: S.ended, geo: { cx: S.geo.cx.slice(), cy: S.geo.cy.slice(), s: S.geo.s }, status: statusEl.textContent,
        };
      },
    };
  },
};
