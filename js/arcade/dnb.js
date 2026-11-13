/* ============================================================
   arcade/dnb.js — Dots and Boxes for Static Arcade.

   Draw a line between two neighbouring dots. Close the fourth side of
   a box and it is yours — and you draw again. Most boxes wins. Boards
   from 3 × 3 to 6 × 6 boxes (rules and computer in ./dnb-rules.js).

   · 1P: against the computer (Easy, Medium, Hard — Hard is
     chain-aware and solves the last 17 lines exactly), you or the
     computer first. Size, level and first are remembered in
     portal.arcadeDnb. The search runs in a Web Worker. Undo takes
     back your turn (every line since your last one began).
   · 2P: Blue and Pink take turns on one screen.
   · Online: a friend on another device through the Arcade's room.
     The host draws first in odd rounds, the guest in even ones; on
     your screen you are always blue. Every arriving line is checked
     (whose turn, an undrawn line) before it reaches the board.

   Mouse or touch: click or tap near a line. Keyboard: arrow keys move
   to the nearest undrawn line in that direction, Enter / Space draw
   it, U / Z / Backspace undo.
   Score in 1P: the boxes you took when you win (more is better).
   ============================================================ */
import { h } from '../core/dom.js';
import { store } from '../core/store.js';
import * as D from './dnb-rules.js';
import { thinker } from './thinker.js';
import { KIT_CSS, surface, ownsKey, sounder, looper, playerStrip, segment, button, confirmButton, duelLink } from './boardkit.js';

const PREF = 'portal.arcadeDnb';
const BLUE = '#4dd2ff', PINK = '#ff4d6d';
const MIN_THINK_MS = 380;

const readPrefs = () => {
  let p = null;
  try { p = store.get(PREF, null); } catch (err) { p = null; }
  return { level: [1, 2, 3].includes(p?.level) ? p.level : 2, first: p?.first === 'cpu' ? 'cpu' : 'me', n: D.SIZES.includes(p?.n) ? p.n : 4 };
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
    /* online the board is 4 × 4 on both screens */
    let me = mode === 'online' ? ((round % 2 === 1) === host ? 1 : -1) : mode === 'cpu' ? (prefs.first === 'cpu' ? -1 : 1) : 0;
    let dead = false;

    const S = {
      n: mode === 'online' ? 4 : prefs.n, g: D.newGame(4), by: [], over: null, hover: -1, cur: -1, kb: false, thinking: false, thinkId: 0,
      level: prefs.level, first: prefs.first, rejected: 0, myBoxes: 0, ended: false, endT: 0, geo: { x: 0, y: 0, s: 0 }, shake: 0, claimed: new Map(), last: -1,
    };
    const colorOf = v => (mode === '2p' ? (v === 1 ? BLUE : PINK) : v === me ? BLUE : PINK);
    const nameOf = v => (mode === '2p' ? (v === 1 ? 'Blue' : 'Pink') : v === me ? 'You' : mode === 'cpu' ? 'The computer' : peerName);
    const boxesOf = v => S.g.score[v === 1 ? 0 : 1];

    /* ------------------------------ the page ------------------------------ */
    const boardEl = h('div.arx-bg__board');
    const sr = h('div.arx-bg__sr', { 'aria-live': 'polite' });
    const statusEl = h('div.arx-bg__status', { role: 'status' });
    const topStrip = playerStrip(PINK, '', '');
    const botStrip = playerStrip(BLUE, '', '');
    const sizeSeg = mode !== 'online' ? segment('Size', D.SIZES.map(id => ({ id, label: `${id}×${id}` })), S.n, setSize) : null;
    const levelSeg = mode === 'cpu' ? segment('Level', [1, 2, 3].map(id => ({ id, label: D.LEVELS[id].name })), S.level, setLevel) : null;
    const firstSeg = mode === 'cpu' ? segment('First', [{ id: 'me', label: 'You' }, { id: 'cpu', label: 'Computer' }], S.first, setFirst) : null;
    const undoBtn = mode !== 'online' ? button('Undo', 'corner-up-left', () => { undo(); refocus(); }, { title: 'Take back your last turn (U)' }) : null;
    const resignBtn = mode !== '2p' ? confirmButton('Resign', 'Resign? Click again', 'x', () => { resign(); refocus(); }) : null;
    const note = h('div.arx-bg__note', {
      text: mode === 'online' ? 'A 4×4 board. You are blue on your screen. Close a box and you draw again. Every line is checked on both screens.'
        : mode === '2p' ? 'Two players on this screen: Blue goes first. Close a box and you draw again.'
          : 'Click near a line, or use the arrow keys and Enter. Close a box and you draw again.',
    });
    const side = h('div.arx-bg__side', topStrip.el, statusEl, sizeSeg?.el, levelSeg?.el, firstSeg?.el, h('div.arx-bg__row', undoBtn, resignBtn), note, botStrip.el);
    const root = h('div.arx-bgc', h('style', { text: KIT_CSS }), h('div.arx-bg', boardEl, side), sr);
    el.appendChild(root);
    const sf = surface(boardEl, 'Dots and Boxes board', () => draw());
    const loop = looper(() => draw());
    const refocus = () => el.closest('[tabindex]')?.focus({ preventScroll: true });

    const link = NET ? duelLink(NET, {
      plies: () => S.g.moves.length,
      mine: i => S.by[i] === 'me',
      wire: i => ({ e: S.g.moves[i] }),
      take: d => {
        if (S.over || S.g.turn !== -me || !Number.isInteger(d.e) || !D.canPlay(S.g, d.e)) return false;
        apply(d.e, 'peer');
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
      Object.assign(S, { g: D.newGame(S.n, 1), by: [], over: null, thinking: false, myBoxes: 0, ended: false, claimed: new Map(), last: -1, cur: -1 });
      S.thinkId++;
      ctx.onScore(0);
      NET?.peerScore?.(0);
      paint();
      if (mode === 'cpu' && S.g.turn !== me) computerMove();
    }
    const canAct = () => !dead && !S.over && !S.thinking && (mode === '2p' || S.g.turn === me);

    function tryDraw(e) {
      if (!canAct()) return false;
      if (!D.canPlay(S.g, e)) {
        S.shake = performance.now();
        snd.blip(140, 0.08, 'sawtooth', 0.4);
        loop.kick(0.25);
        return false;
      }
      apply(e, 'me');
      link?.sendMove(S.g.moves.length - 1);
      return true;
    }

    function apply(e, by) {
      const g = S.g, v = g.turn;
      const got = D.play(g, e);
      S.by.push(by);
      S.last = e;
      if (got > 0) {
        if (by === 'me') S.myBoxes += got;
        for (const b of D.edgeBoxes(g.n, e)) if (b >= 0 && g.owner[b] === v) S.claimed.set(b, performance.now());
      }
      loop.kick(reduced ? 0.05 : 0.5);
      snd.blip(got ? 620 : 360, 0.06, 'triangle', 0.7);
      const o = D.outcome(g);
      if (o.over) S.over = o;
      say(`${nameOf(v)} drew a line${got ? ` and took ${got === 1 ? 'a box' : 'two boxes'}, and plays again` : ''}.${o.over ? ' ' + overText() : ''}`);
      if (S.kb || S.cur >= 0) S.cur = nearestUndrawn(e, null);
      paint();
      if (S.over) { loop.kick(2); finishSoon(); }
      else if (mode === 'cpu' && g.turn !== me) computerMove();
    }

    async function computerMove() {
      const id = ++S.thinkId;
      S.thinking = true;
      paint();
      const t0 = performance.now();
      const res = await brain.ask({ game: 'dnb', n: S.g.n, first: S.g.first, moves: S.g.moves.slice(), level: S.level });
      if (dead || id !== S.thinkId) return;
      const wait = MIN_THINK_MS - (performance.now() - t0);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      if (dead || id !== S.thinkId) return;
      S.thinking = false;
      if (!res || !D.canPlay(S.g, res.edge)) {
        statusEl.textContent = 'The computer could not move. Press Undo or start again.';
        statusEl.classList.add('is-alert');
        return;
      }
      apply(res.edge, 'cpu');
    }

    function undo() {
      if (mode === 'online' || S.over || dead) return;
      const g = S.g;
      if (mode === '2p') {
        if (!g.moves.length) return;
        D.undo(g); S.by.pop();
      } else {
        const mine = S.by.indexOf('me') < 0 ? -1 : (() => {
          /* the first line of my latest turn: walk back over my consecutive lines */
          let i = S.by.length - 1;
          while (i >= 0 && S.by[i] !== 'me') i--;
          while (i > 0 && S.by[i - 1] === 'me') i--;
          return i;
        })();
        if (mine < 0) return;
        if (S.thinking) { brain.cancel(); S.thinkId++; S.thinking = false; }
        while (g.moves.length > mine) { D.undo(g); S.by.pop(); }
        S.myBoxes = 0;
        for (let b = 0; b < g.owner.length; b++) if (g.owner[b] === me) S.myBoxes++;
      }
      S.claimed = new Map();
      for (let b = 0; b < g.owner.length; b++) if (g.owner[b]) S.claimed.set(b, 0);
      snd.blip(330, 0.07, 'triangle', 0.6, 220);
      say('Line taken back.');
      paint();
      if (mode === 'cpu' && g.turn !== me) computerMove();
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
      const o = S.over, g = S.g;
      const tally = `${g.score[0]}–${g.score[1]}`;
      if (mode === 'online') {
        const won = o.winner === 0 ? null : o.winner === me;
        const mineB = boxesOf(me), theirs = boxesOf(-me);
        const detail = o.reason === 'resign' ? (o.who === 'me' ? 'You resigned.' : `${peerName} resigned.`)
          : o.winner === 0 ? `A draw: ${mineB} boxes each.` : `Final count: you ${mineB}, ${peerName} ${theirs}.`;
        ctx.onEnd({ score: mineB, won, versus: { me: mineB, them: theirs }, detail });
        return;
      }
      if (mode === '2p') {
        ctx.onEnd({ score: null, detail: o.winner === 0 ? `A draw, ${tally}.` : `${nameOf(o.winner)} wins ${Math.max(...g.score)}–${Math.min(...g.score)}.` });
        return;
      }
      const lv = D.LEVELS[S.level].name, mineB = boxesOf(me), theirs = boxesOf(-me);
      if (o.winner === me) ctx.onEnd({ score: mineB, won: true, detail: `You won ${mineB}–${theirs} on ${S.n}×${S.n} against the computer (${lv}).` });
      else if (o.winner === 0) ctx.onEnd({ score: null, won: false, detail: `A draw, ${mineB}–${theirs}, against the computer (${lv}).` });
      else ctx.onEnd({ score: null, won: false, detail: o.reason === 'resign' ? `You resigned against the computer (${lv}).` : `The computer (${lv}) won ${theirs}–${mineB}.` });
    }

    function setLevel(v) { S.level = v; writePrefs({ level: v }); levelSeg.set(v); paint(); refocus(); }
    function setFirst(v) {
      S.first = v; writePrefs({ first: v }); firstSeg.set(v);
      me = v === 'cpu' ? -1 : 1;
      newGame(); refocus();
    }
    function setSize(v) { S.n = v; writePrefs({ n: v }); sizeSeg.set(v); newGame(); refocus(); }

    /* ------------------------------ text ------------------------------ */
    function overText() {
      const o = S.over;
      if (!o) return '';
      if (o.winner === 0) return `A draw, ${S.g.score[0]}–${S.g.score[1]}.`;
      if (mode === '2p') return `${nameOf(o.winner)} wins ${Math.max(...S.g.score)}–${Math.min(...S.g.score)}!`;
      if (o.reason === 'resign') return o.who === 'me' ? 'You resigned.' : `${peerName} resigned — you win.`;
      return o.winner === me ? `You win ${boxesOf(me)}–${boxesOf(-me)}!` : `${mode === 'cpu' ? 'The computer' : peerName} wins ${boxesOf(-me)}–${boxesOf(me)}.`;
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
      topStrip.set({ name: mode === '2p' ? 'Pink' : mode === 'cpu' ? 'Computer' : peerName, note: `${boxesOf(topV)} boxes${mode === 'cpu' ? ` · ${D.LEVELS[S.level].name}` : ''}`,
        color: colorOf(topV), turn: !S.over && g.turn === topV, thinking: S.thinking });
      botStrip.set({ name: mode === '2p' ? 'Blue' : 'You', note: `${boxesOf(botV)} boxes`, color: colorOf(botV), turn: !S.over && g.turn === botV });
      if (undoBtn) undoBtn.disabled = !!S.over || (mode === '2p' ? !g.moves.length : !S.by.includes('me'));
      if (resignBtn) { resignBtn.disabled = !!S.over; if (S.over) resignBtn.reset(); }
      sf.cv.setAttribute('aria-label', `Dots and Boxes board, ${S.n} by ${S.n}. ${text}`);
      ctx.onScore(mode === '2p' ? Math.max(g.score[0], g.score[1]) : mode === 'cpu' ? boxesOf(me) : boxesOf(me));
      if (NET) NET.peerScore?.(boxesOf(-me));
      draw();
    }

    /* ------------------------------ geometry ------------------------------ */
    function layout() {
      const n = S.n;
      const s = Math.max(20, Math.floor(Math.min(sf.w, sf.h) * 0.9 / n));
      return { s, x: Math.round((sf.w - s * n) / 2), y: Math.round((sf.h - s * n) / 2) };
    }
    const dotXY = (L, r, c) => [L.x + c * L.s, L.y + r * L.s];
    const edgeMid = (L, e) => { const [a, b] = D.edgeDots(S.n, e); const p = dotXY(L, a[0], a[1]), q = dotXY(L, b[0], b[1]); return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; };
    function segDist(px, py, ax, ay, bx, by) {
      const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    }
    /* the nearest undrawn line to a point, within reach */
    function edgeAt(x, y) {
      const L = S.geo;
      let best = -1, bd = L.s * 0.36;
      for (let e = 0; e < S.g.drawn.length; e++) {
        if (S.g.drawn[e]) continue;
        const [a, b] = D.edgeDots(S.n, e), p = dotXY(L, a[0], a[1]), q = dotXY(L, b[0], b[1]);
        const d = segDist(x, y, p[0], p[1], q[0], q[1]);
        if (d < bd) { bd = d; best = e; }
      }
      return best;
    }
    /* keyboard: the nearest undrawn line from `from` in direction dir ([dx, dy]); null dir = just the nearest */
    function nearestUndrawn(from, dir) {
      const L = layout();
      const [fx, fy] = from >= 0 ? edgeMid(L, from) : [L.x + S.n * L.s / 2, L.y + S.n * L.s / 2];
      let best = -1, bs = Infinity;
      for (let e = 0; e < S.g.drawn.length; e++) {
        if (S.g.drawn[e] || e === from) continue;
        const [mx, my] = edgeMid(L, e), dx = mx - fx, dy = my - fy;
        let score;
        if (dir) {
          const along = dx * dir[0] + dy * dir[1], across = Math.abs(dx * dir[1]) + Math.abs(dy * dir[0]);
          if (along < L.s * 0.2) continue;
          score = along + across * 2.5;
        } else score = Math.hypot(dx, dy);
        if (score < bs) { bs = score; best = e; }
      }
      return best >= 0 ? best : from;
    }

    /* ------------------------------ drawing ------------------------------ */
    function draw() {
      if (dead) return;
      const g = sf.g, G = S.g;
      sf.begin();
      const L = S.geo = layout();
      const n = S.n, now = performance.now();
      g.fillStyle = '#05060d';
      g.fillRect(0, 0, sf.w, sf.h);
      const glow = g.createRadialGradient(sf.w / 2, sf.h / 2, 0, sf.w / 2, sf.h / 2, Math.max(sf.w, sf.h) * 0.6);
      glow.addColorStop(0, 'hsla(260,80%,45%,.16)');
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = glow; g.fillRect(0, 0, sf.w, sf.h);
      /* boxes */
      for (let b = 0; b < n * n; b++) {
        const v = G.owner[b];
        const r = Math.floor(b / n), c = b % n;
        const x = L.x + c * L.s, y = L.y + r * L.s;
        if (v) {
          const t0 = S.claimed.get(b), k = reduced || t0 === undefined ? 1 : Math.min(1, (now - t0) / 260);
          g.fillStyle = colorOf(v);
          g.globalAlpha = 0.32 * k;
          g.fillRect(x + L.s * 0.08, y + L.s * 0.08, L.s * 0.84, L.s * 0.84);
          g.globalAlpha = 0.9 * k;
          g.font = `800 ${Math.round(L.s * 0.34)}px system-ui,sans-serif`;
          g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText(mode === '2p' ? (v === 1 ? 'B' : 'P') : v === me ? 'Y' : 'F', x + L.s / 2, y + L.s / 2 + 1);
          g.globalAlpha = 1;
        } else if (G.sides[b] === 3 && !S.over) {
          g.fillStyle = 'rgba(255,255,255,.07)';
          g.fillRect(x + 3, y + 3, L.s - 6, L.s - 6);
        }
      }
      /* lines */
      g.lineCap = 'round';
      const hv = S.kb ? S.cur : S.hover;
      for (let e = 0; e < G.drawn.length; e++) {
        const [a, b] = D.edgeDots(n, e), p = dotXY(L, a[0], a[1]), q = dotXY(L, b[0], b[1]);
        g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]);
        if (G.drawn[e]) {
          const last = e === S.last;
          g.strokeStyle = last ? '#ffffff' : 'rgba(210,225,255,.92)';
          g.lineWidth = Math.max(3, L.s * 0.085);
          if (last) { g.shadowColor = '#fff'; g.shadowBlur = 10; }
        } else if (e === hv && canAct()) {
          g.strokeStyle = colorOf(G.turn);
          g.lineWidth = Math.max(3, L.s * 0.085);
          g.globalAlpha = 0.8;
        } else {
          g.strokeStyle = 'rgba(160,190,255,.14)';
          g.lineWidth = Math.max(2, L.s * 0.04);
        }
        let sx = 0;
        if (S.shake && now - S.shake < 200) sx = Math.sin((now - S.shake) / 18) * 3 * (1 - (now - S.shake) / 200);
        if (sx) { g.save(); g.translate(sx, 0); g.stroke(); g.restore(); } else g.stroke();
        g.shadowBlur = 0; g.globalAlpha = 1;
      }
      /* dots */
      g.fillStyle = '#e8eeff';
      for (let r = 0; r <= n; r++) for (let c = 0; c <= n; c++) { const [x, y] = dotXY(L, r, c); g.beginPath(); g.arc(x, y, Math.max(3, L.s * 0.075), 0, Math.PI * 2); g.fill(); }
    }

    /* ------------------------------ input ------------------------------ */
    const at = e => { const r = sf.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const onDown = e => {
      if (e.button > 0 || dead) return;
      snd.wake();
      S.kb = false;
      const p = at(e), ed = edgeAt(p.x, p.y);
      if (ed < 0) return;
      S.hover = ed;
      tryDraw(ed);
    };
    const onMove = e => {
      const p = at(e), ed = edgeAt(p.x, p.y);
      S.kb = false;
      if (ed !== S.hover) { S.hover = ed; sf.cv.style.cursor = ed >= 0 && canAct() ? 'pointer' : 'default'; draw(); }
    };
    const onLeave = () => { if (S.hover !== -1) { S.hover = -1; draw(); } };
    const onKey = e => {
      if (!ownsKey(el, e) || dead || S.ended) return;
      const k = e.key;
      const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[k];
      if (dir) {
        e.preventDefault(); snd.wake();
        S.kb = true;
        if (S.cur < 0 || S.g.drawn[S.cur]) S.cur = nearestUndrawn(-1, null);
        else S.cur = nearestUndrawn(S.cur, dir);
        draw();
        return;
      }
      if (k === 'Enter' || k === ' ') {
        e.preventDefault(); snd.wake(); S.kb = true;
        if (S.cur < 0 || S.g.drawn[S.cur]) { S.cur = nearestUndrawn(-1, null); draw(); return; }
        tryDraw(S.cur);
        return;
      }
      if ((k === 'u' || k === 'U' || k === 'z' || k === 'Z' || k === 'Backspace') && mode !== 'online') { e.preventDefault(); undo(); }
    };
    window.addEventListener('keydown', onKey);
    sf.cv.addEventListener('pointerdown', onDown);
    sf.cv.addEventListener('pointermove', onMove);
    sf.cv.addEventListener('pointerleave', onLeave);

    newGame();

    const id = v => (v === 1 ? 1 : v === -1 ? 2 : 0);
    /* the board as text: dots '+', lines '-' '|' (drawn) or ' ', boxes by owner digit */
    const grid = () => {
      const n = S.n, out = [];
      for (let r = 0; r <= 2 * n; r++) {
        let s = '';
        for (let c = 0; c <= 2 * n; c++) {
          if (r % 2 === 0 && c % 2 === 0) s += '+';
          else if (r % 2 === 0) s += S.g.drawn[D.hEdge(n, r / 2, (c - 1) / 2)] ? '-' : ' ';
          else if (c % 2 === 0) s += S.g.drawn[D.vEdge(n, (r - 1) / 2, c / 2)] ? '|' : ' ';
          else { const o = S.g.owner[((r - 1) / 2) * n + (c - 1) / 2]; s += o === 1 ? '1' : o === -1 ? '2' : ' '; }
        }
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
        window.removeEventListener('keydown', onKey);
        sf.cv.removeEventListener('pointerdown', onDown);
        sf.cv.removeEventListener('pointermove', onMove);
        sf.cv.removeEventListener('pointerleave', onLeave);
        resignBtn?.reset();
        snd.close();
        sf.destroy();
        root.remove();
      },
      /* what a watcher is allowed to see (js/arcade/spectate.js): the board as text, scores, whose turn */
      spectate: () => ({
        k: 'board', st: 'dnb', w: S.n, h: S.n, cells: grid().join(''),
        hl: S.last >= 0 ? [S.last] : [], txt: statusEl.textContent, over: !!S.over,
        pl: [{ n: mode === '2p' ? 'Blue' : (me === 1 ? 'You' : (mode === 'cpu' ? 'Computer' : peerName)), m: `${S.g.score[0]} boxes` },
          { n: mode === '2p' ? 'Pink' : (me === 1 ? (mode === 'cpu' ? 'Computer' : peerName) : 'You'), m: `${S.g.score[1]} boxes` }],
        turn: S.over ? 0 : S.g.turn,
      }),
      peek: () => ({
        mode, me: mode === '2p' ? null : id(me), turn: id(S.g.turn), n: S.n, grid: grid(), moves: S.g.moves.join(','), score: S.g.score.slice(),
        sides: Array.from(S.g.sides).join(''), owner: Array.from(S.g.owner, id).join(''),
        over: S.over ? { winner: id(S.over.winner), reason: S.over.reason || 'full' } : null,
        level: S.level, first: S.first, thinking: S.thinking, worker: !!brain?.worker, rejected: S.rejected, myBoxes: S.myBoxes, ended: S.ended,
        cursor: S.cur, geo: { ...S.geo }, status: statusEl.textContent,
        /* where each undrawn line is on the page, for a test to click */
        edges: Array.from(S.g.drawn, (_d, e) => edgeMid(S.geo, e)),
      }),
    };
  },
};
