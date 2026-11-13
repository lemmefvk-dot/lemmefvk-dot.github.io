/* ============================================================
   arcade/mancala.js — Mancala (Kalah) for Static Arcade.

   Six pits a side, four stones in each, a store at each end. Lift a
   pit, sow it round counter-clockwise, one stone per pit, skipping
   your opponent's store. Last stone in your store: go again. Last
   stone in an empty pit on your side: take it and the stones across.
   The game ends when a side runs out; the other keeps what is left.
   The exact rules are in ./mancala-rules.js and in the side panel.

   · 1P: against the computer (Easy, Medium, Hard — alpha-beta in
     ./mancala-rules.js, run in the Arcade's thinking worker), you or
     the computer first; both remembered in portal.arcadeMancala.
     Undo takes back your last move and the replies.
   · 2P: two people on one screen; whoever's turn it is clicks one of
     their own pits (the bottom row is player 1, the top row player 2).
   · Online: a friend on another device through the Arcade's room.
     The host goes first in odd rounds. On your screen your pits are
     always the bottom row. Every arriving move is checked by the
     rules engine (whose turn, a pit with stones) before it counts.

   Sowing is animated one stone at a time (and skipped with reduced
   motion). Mouse or touch: click one of your pits. Keyboard: ← →
   pick a pit, Enter / Space / ↓ sow it, 1–6 sow that pit (counting
   from your left), U / Z / Backspace undo.
   Score in 1P: the stones in your store when you win.
   ============================================================ */
import { h } from '../core/dom.js';
import { store } from '../core/store.js';
import { newGame as freshGame, canPlay, play, outcome, copy, legal, LEVELS, storeOf, pitOf, PITS } from './mancala-rules.js';
import { thinker } from './thinker.js';
import { KIT_CSS, surface, ownsKey, sounder, looper, rr, playerStrip, segment, button, confirmButton, duelLink } from './boardkit.js';

const PREF = 'portal.arcadeMancala';
const MIN_THINK_MS = 420;
const STEP_MS = 175;
const SEED_HUES = [18, 42, 160, 200, 280, 340];

const readPrefs = () => {
  let p = null;
  try { p = store.get(PREF, null); } catch (err) { p = null; }
  return { level: [1, 2, 3].includes(p?.level) ? p.level : 2, first: p?.first === 'cpu' ? 'cpu' : 'me' };
};
const writePrefs = patch => { try { store.set(PREF, { ...readPrefs(), ...patch }); } catch (err) { /* a convenience */ } };
const seed32 = () => crypto.getRandomValues(new Uint32Array(1))[0] >>> 0;

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
    /* me: the seat (0 moves first) whose pits are the bottom row on this screen */
    let me = mode === 'online' ? ((round % 2 === 1) === host ? 0 : 1) : mode === 'cpu' ? (prefs.first === 'cpu' ? 1 : 0) : 0;
    let dead = false;

    const S = {
      g: freshGame(0), by: [], over: null, show: null, hover: -1, cursor: 0, kb: false,
      thinking: false, thinkId: 0, level: prefs.level, first: prefs.first, rejected: 0, myMoves: 0,
      ended: false, endT: 0, geo: null, shake: 0, q: [], busy: false, idle: [], flash: null, hand: null, timers: new Set(),
    };
    const nameOf = s => (mode === '2p' ? `Player ${s + 1}` : s === me ? 'You' : mode === 'cpu' ? 'The computer' : peerName);

    /* ------------------------------ the page ------------------------------ */
    const boardEl = h('div.arx-bg__board');
    const sr = h('div.arx-bg__sr', { 'aria-live': 'polite' });
    const statusEl = h('div.arx-bg__status', { role: 'status' });
    const topStrip = playerStrip('#ff7a59', '', '');
    const botStrip = playerStrip('#ffd23f', '', '');
    const levelSeg = mode === 'cpu' ? segment('Level', [1, 2, 3].map(id => ({ id, label: LEVELS[id].name })), S.level, setLevel) : null;
    const firstSeg = mode === 'cpu' ? segment('First', [{ id: 'me', label: 'You' }, { id: 'cpu', label: 'Computer' }], S.first, setFirst) : null;
    const undoBtn = mode !== 'online' ? button('Undo', 'corner-up-left', () => { undo(); refocus(); }, { title: 'Take back your last move (U)' }) : null;
    const resignBtn = mode !== '2p' ? confirmButton('Resign', 'Resign? Click again', 'x', () => { resign(); refocus(); }) : null;
    const note = h('div.arx-bg__note', {
      text: 'Kalah rules. 6 pits, 4 stones each. Sow counter-clockwise, skipping your opponent’s store. '
        + 'Last stone in your store: move again. Last stone in an empty pit of yours with stones across: capture both. '
        + 'The game ends when a side is empty and the other side keeps what is left.',
    });
    const side = h('div.arx-bg__side', topStrip.el, statusEl, levelSeg?.el, firstSeg?.el, h('div.arx-bg__row', undoBtn, resignBtn), note, botStrip.el);
    const root = h('div.arx-bgc', h('style', { text: KIT_CSS }), h('div.arx-bg', boardEl, side), sr);
    el.appendChild(root);
    const sf = surface(boardEl, 'Mancala board', () => draw());
    const loop = looper(() => draw());
    const refocus = () => el.closest('[tabindex]')?.focus({ preventScroll: true });
    const later = (fn, ms) => { const t = setTimeout(() => { S.timers.delete(t); fn(); }, ms); S.timers.add(t); return t; };

    const link = NET ? duelLink(NET, {
      plies: () => S.g.moves.length,
      mine: i => S.by[i] === 'me',
      wire: i => ({ p: S.g.moves[i] }),
      take: d => {
        if (S.over || S.g.turn !== 1 - me || !Number.isInteger(d.p) || !canPlay(S.g, d.p)) return false;
        apply(d.p, 'peer');
        return true;
      },
      reject: () => { S.rejected++; },
      resigned: () => {
        if (S.over) return;
        S.over = { over: true, winner: me, reason: 'resign', who: 'them' };
        say(`${peerName} resigned.`);
        paint();
        whenIdle(() => finishSoon());
      },
      dead: () => dead,
    }) : null;

    /* ------------------------------ rules glue ------------------------------ */
    function newGame() {
      brain?.cancel();
      clearTimeout(S.endT);
      S.timers.forEach(clearTimeout); S.timers.clear();
      const first = 0;
      Object.assign(S, { g: freshGame(first), by: [], over: null, thinking: false, myMoves: 0, ended: false, cursor: 0, q: [], busy: false, idle: [], flash: null, hand: null });
      S.show = Array.from(S.g.b);
      S.thinkId++;
      ctx.onScore(0);
      NET?.peerScore?.(0);
      paint();
      if (mode === 'cpu' && S.g.turn !== me) computerMove();
    }
    const canAct = () => !dead && !S.over && !S.thinking && !S.busy && (mode === '2p' || S.g.turn === me);
    const whenIdle = fn => { if (S.busy) S.idle.push(fn); else fn(); };

    /** the local pit (0–5) a click or key means: only the side that is to move */
    function tryPit(k) {
      if (!canAct()) return false;
      if (!canPlay(S.g, k)) {
        S.shake = performance.now();
        snd.blip(140, 0.08, 'sawtooth', 0.4);
        loop.kick(0.25);
        say(`Pit ${k + 1} is empty.`);
        return false;
      }
      apply(k, 'me');
      link?.sendMove(S.g.moves.length - 1);
      return true;
    }

    function apply(k, by) {
      const g = S.g, before = Array.from(g.b), who = g.turn;
      const res = play(g, k);
      S.by.push(by);
      if (by === 'me') S.myMoves++;
      const o = outcome(g);
      if (o.over) S.over = o;
      say(`${nameOf(who)} sowed pit ${k + 1}.${res.extra && !o.over ? ' Last stone in the store: ' + nameOf(who) + ' goes again.' : ''}${res.capture ? ` Captured ${res.capture.n} stones.` : ''}${o.over ? ' ' + overText() : ''}`);
      S.q.push({ res, before, after: Array.from(g.b), who });
      paintSoon();
      runQ();
      whenIdle(() => {
        if (dead) return;
        paint();
        if (S.over) finishSoon();
        else if (mode === 'cpu' && S.g.turn !== me) computerMove();
      });
    }

    /* sowing: one stone every STEP_MS; with reduced motion the board just becomes what it is */
    function runQ() {
      if (S.busy || dead) return;
      const a = S.q.shift();
      if (!a) { const cbs = S.idle.splice(0); cbs.forEach(fn => fn()); return; }
      if (reduced) { S.show = a.after; S.flash = a.res.capture ? { pit: a.res.capture.pit, t0: performance.now() } : null; snd.blip(330, 0.06, 'triangle', 0.6); paint(); runQ(); return; }
      S.busy = true;
      const board = a.before.slice();
      S.show = board;
      board[a.res.from] = 0;
      S.hand = { from: a.res.from, left: a.res.steps.length };
      let i = 0;
      const tick = () => {
        if (dead) return;
        if (i < a.res.steps.length) {
          const p = a.res.steps[i++];
          board[p]++;
          S.hand.left = a.res.steps.length - i;
          S.hand.at = p;
          snd.blip(260 + (i % 7) * 34, 0.05, 'triangle', 0.55);
          loop.kick(STEP_MS / 1000 + 0.05);
          later(tick, STEP_MS);
          return;
        }
        S.hand = null;
        if (a.res.capture) {
          S.flash = { pit: a.res.capture.pit, t0: performance.now() };
          snd.blip(520, 0.12, 'square', 0.6, 880);
          loop.kick(0.9);
          later(() => { S.show = a.after; S.busy = false; S.flash = null; paint(); runQ(); }, 520);
        } else {
          if (a.res.extra) snd.blip(660, 0.1, 'sine', 0.7, 990);
          S.show = a.after;
          S.busy = false;
          paint();
          runQ();
        }
      };
      later(tick, 60);
      loop.kick(0.3);
    }

    async function computerMove() {
      const id = ++S.thinkId;
      S.thinking = true;
      paint();
      const t0 = performance.now();
      const g = S.g;
      const res = await brain.ask({ game: 'mancala', b: Array.from(g.b), turn: g.turn, level: S.level, seed: seed32() });
      if (dead || id !== S.thinkId) return;
      const wait = MIN_THINK_MS - (performance.now() - t0);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      if (dead || id !== S.thinkId) return;
      S.thinking = false;
      if (!res || !canPlay(S.g, res.k)) {
        statusEl.textContent = 'The computer could not move. Press Undo or start again.';
        statusEl.classList.add('is-alert');
        return;
      }
      apply(res.k, 'cpu');
    }

    function undo() {
      if (mode === 'online' || S.over || dead) return;
      const g = S.g;
      /* rebuild from the move list: simplest way to be exactly right */
      let keep;
      if (mode === '2p') keep = g.moves.length - 1;
      else { const mine = S.by.lastIndexOf('me'); keep = mine; }
      if (keep < 0) return;
      if (S.thinking) { brain.cancel(); S.thinkId++; S.thinking = false; }
      const moves = g.moves.slice(0, keep), by = S.by.slice(0, keep);
      S.timers.forEach(clearTimeout); S.timers.clear();
      S.q = []; S.busy = false; S.idle = []; S.hand = null; S.flash = null;
      const ng = freshGame(0);
      for (const k of moves) play(ng, k);
      S.g = ng; S.by = by; S.myMoves = by.filter(b => b === 'me').length;
      S.show = Array.from(ng.b);
      snd.blip(330, 0.07, 'triangle', 0.6, 220);
      say('Move taken back.');
      paint();
      if (mode === 'cpu' && S.g.turn !== me) computerMove();
    }

    function resign() {
      if (S.over || dead) return;
      if (S.thinking) { brain?.cancel(); S.thinkId++; S.thinking = false; }
      S.over = { over: true, winner: 1 - me, reason: 'resign', who: 'me', score: [S.g.b[6], S.g.b[13]] };
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
      const o = S.over, mine = o.score[me], theirs = o.score[1 - me];
      if (mode === 'online') {
        const won = o.winner === -1 ? null : o.winner === me;
        const detail = o.reason === 'resign' ? (o.who === 'me' ? 'You resigned.' : `${peerName} resigned.`)
          : won === null ? `A draw, ${mine} stones each.` : `${mine} stones to ${theirs}.`;
        ctx.onEnd({ score: null, won, versus: { me: mine, them: theirs }, detail });
        return;
      }
      if (mode === '2p') {
        ctx.onEnd({ score: null, detail: o.winner === -1 ? `A draw, ${o.score[0]} stones each.` : `Player ${o.winner + 1} wins, ${o.score[o.winner]} stones to ${o.score[1 - o.winner]}.` });
        return;
      }
      const lv = LEVELS[S.level].name;
      if (o.winner === me) ctx.onEnd({ score: mine, won: true, detail: `You won ${mine} stones to ${theirs} against the computer (${lv}).` });
      else if (o.winner === -1) ctx.onEnd({ score: null, won: false, detail: `A draw, ${mine} stones each, against the computer (${lv}).` });
      else ctx.onEnd({ score: null, won: false, detail: o.reason === 'resign' ? `You resigned against the computer (${lv}).` : `The computer (${lv}) won ${theirs} stones to ${mine}.` });
    }

    function setLevel(v) { S.level = v; writePrefs({ level: v }); levelSeg.set(v); paint(); refocus(); }
    function setFirst(v) {
      S.first = v;
      writePrefs({ first: v });
      firstSeg.set(v);
      me = v === 'cpu' ? 1 : 0;
      newGame();
      refocus();
    }

    /* ------------------------------ text ------------------------------ */
    function overText() {
      const o = S.over;
      if (!o) return '';
      if (o.winner === -1) return `A draw, ${o.score[0]} stones each.`;
      if (mode === '2p') return `Player ${o.winner + 1} wins, ${o.score[o.winner]} to ${o.score[1 - o.winner]}.`;
      if (o.reason === 'resign') return o.who === 'me' ? 'You resigned.' : `${peerName} resigned — you win.`;
      return o.winner === me ? `You win, ${o.score[me]} to ${o.score[1 - me]}!` : `${nameOf(1 - me)} wins, ${o.score[1 - me]} to ${o.score[me]}.`;
    }
    function say(t) { sr.textContent = t; }
    let paintT = 0;
    const paintSoon = () => { if (!paintT) paintT = requestAnimationFrame(() => { paintT = 0; paint(); }); };

    function paint() {
      if (dead) return;
      const g = S.g;
      let text;
      if (S.over) text = overText();
      else if (mode === 'cpu') text = g.turn === me ? 'Your move' : 'The computer is thinking…';
      else if (mode === '2p') text = `${nameOf(g.turn)} to move`;
      else text = g.turn === me ? 'Your move' : `${peerName}’s move`;
      if (!S.over && S.busy) text = 'Sowing…';
      statusEl.textContent = text;
      statusEl.classList.remove('is-alert');
      statusEl.classList.toggle('is-done', !!S.over);
      const topS = 1 - (mode === '2p' ? 0 : me), botS = mode === '2p' ? 0 : me;
      const inStore = s => (S.busy || S.q.length ? S.show[storeOf(s)] : g.b[storeOf(s)]);
      topStrip.set({ name: mode === '2p' ? 'Player 2' : mode === 'cpu' ? 'Computer' : peerName,
        note: `${mode === 'cpu' ? LEVELS[S.level].name + ' · ' : ''}${inStore(topS)} in store · goes ${topS === 0 ? 'first' : 'second'}`, turn: !S.over && g.turn === topS, thinking: S.thinking });
      botStrip.set({ name: mode === '2p' ? 'Player 1' : 'You', note: `${inStore(botS)} in store · goes ${botS === 0 ? 'first' : 'second'}`, turn: !S.over && g.turn === botS });
      if (undoBtn) undoBtn.disabled = !!S.over || (mode === '2p' ? !g.moves.length : !S.by.includes('me'));
      if (resignBtn) { resignBtn.disabled = !!S.over; if (S.over) resignBtn.reset(); }
      sf.cv.setAttribute('aria-label', `Mancala board. ${text}. Your pits: ${[0, 1, 2, 3, 4, 5].map(k => g.b[pitOf(botS, k)]).join(', ')}. Opponent pits: ${[0, 1, 2, 3, 4, 5].map(k => g.b[pitOf(topS, k)]).join(', ')}.`);
      ctx.onScore(g.b[storeOf(mode === '2p' ? 0 : me)]);
      if (NET) NET.peerScore?.(g.b[storeOf(1 - me)]);
      draw();
    }

    /* ------------------------------ drawing ------------------------------ */
    /* column c (0–7, left to right) of the board; the bottom row is the viewer's side */
    const botSide = () => (mode === '2p' ? 0 : me);
    function layout() {
      const cell = Math.max(24, Math.min(sf.w / 8.6, sf.h / 3.5));
      const w = cell * 8, hh = cell * 2.7;
      return { cell, x: Math.round((sf.w - w) / 2), y: Math.round((sf.h - hh) / 2), w, hh };
    }
    /* the board index of the pit/store at (row, col): row 0 top, 1 bottom */
    function slotAt(L, idx) {
      const bs = botSide();
      const owner = idx < 7 ? 0 : 1, isStore = idx === 6 || idx === 13;
      const k = idx - owner * 7;
      if (isStore) return { cx: L.x + (owner === bs ? 7.5 : 0.5) * L.cell, cy: L.y + L.hh / 2, store: true };
      const col = owner === bs ? 1 + k : 6 - k;
      return { cx: L.x + (col + 0.5) * L.cell, cy: L.y + (owner === bs ? 2.0 : 0.7) * L.cell + (owner === bs ? 0 : 0), store: false };
    }
    function pitAt(x, y) {
      const L = S.geo;
      if (!L) return -1;
      for (const s of [0, 1]) {
        if (mode !== '2p' && s !== me) continue;
        for (let k = 0; k < PITS; k++) {
          const p = slotAt(L, pitOf(s, k));
          if (Math.hypot(x - p.cx, y - p.cy) <= L.cell * 0.46) return { s, k };
        }
      }
      return -1;
    }

    function stones(g, cx, cy, r, n, idx) {
      const cap = Math.min(n, 24);
      for (let i = 0; i < cap; i++) {
        const a = i * 2.399963 + idx, d = Math.sqrt((i + 0.6) / (cap + 1)) * r * 0.78;
        const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d, sr = Math.max(3, r * 0.17);
        const hue = SEED_HUES[(i * 3 + idx) % SEED_HUES.length];
        const gr = g.createRadialGradient(x - sr * 0.3, y - sr * 0.35, sr * 0.1, x, y, sr);
        gr.addColorStop(0, `hsl(${hue},85%,82%)`);
        gr.addColorStop(1, `hsl(${hue},70%,42%)`);
        g.fillStyle = gr;
        g.beginPath(); g.arc(x, y, sr, 0, Math.PI * 2); g.fill();
      }
    }

    function draw() {
      if (dead) return;
      const g = sf.g;
      sf.begin();
      const L = S.geo = layout();
      const now = performance.now();
      const show = S.busy || S.q.length ? S.show : Array.from(S.g.b);
      g.fillStyle = '#05060d';
      g.fillRect(0, 0, sf.w, sf.h);
      const glow = g.createRadialGradient(sf.w / 2, sf.h * 0.55, 0, sf.w / 2, sf.h * 0.55, Math.max(sf.w, sf.h) * 0.6);
      glow.addColorStop(0, 'hsla(30,90%,45%,.18)');
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = glow;
      g.fillRect(0, 0, sf.w, sf.h);
      let sx = 0;
      if (S.shake && now - S.shake < 200) sx = Math.sin((now - S.shake) / 18) * 4 * (1 - (now - S.shake) / 200);
      g.save();
      g.translate(sx, 0);
      /* the wooden board */
      g.shadowBlur = 24; g.shadowColor = 'hsla(28,100%,50%,.4)';
      const bg = g.createLinearGradient(0, L.y, 0, L.y + L.hh);
      bg.addColorStop(0, '#6b4226'); bg.addColorStop(1, '#4a2b16');
      g.fillStyle = bg;
      rr(g, L.x, L.y, L.w, L.hh, L.cell * 0.35);
      g.fill();
      g.shadowBlur = 0;
      g.strokeStyle = 'rgba(255,200,140,.35)'; g.lineWidth = 1.5; g.stroke();
      const turnSide = S.over ? -1 : S.g.turn;
      for (let idx = 0; idx < 14; idx++) {
        const p = slotAt(L, idx), owner = idx < 7 ? 0 : 1;
        const n = show[idx];
        const isMine = canAct() && owner === S.g.turn && idx !== 6 && idx !== 13;
        if (p.store) {
          const w = L.cell * 0.82, hh = L.hh * 0.86;
          g.fillStyle = 'rgba(20,10,4,.62)';
          rr(g, p.cx - w / 2, p.cy - hh / 2, w, hh, w / 2);
          g.fill();
          if (turnSide === owner) { g.strokeStyle = 'rgba(255,220,120,.75)'; g.lineWidth = 2; g.stroke(); }
          stones(g, p.cx, p.cy, w * 0.42, Math.min(n, 18), idx);
          g.fillStyle = '#ffe9c2'; g.font = `800 ${Math.round(L.cell * 0.3)}px Inter,system-ui,sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText(String(n), p.cx, owner === botSide() ? p.cy + hh / 2 - L.cell * 0.28 : p.cy - hh / 2 + L.cell * 0.28);
          continue;
        }
        const r = L.cell * 0.4;
        const k = idx - owner * 7;
        const hot = isMine && ((S.kb && owner === botSide() && S.cursor === k) || (!S.kb && S.hover && S.hover.s === owner && S.hover.k === k));
        g.fillStyle = n === 0 && isMine ? 'rgba(10,5,2,.5)' : 'rgba(20,10,4,.65)';
        g.beginPath(); g.arc(p.cx, p.cy, r, 0, Math.PI * 2); g.fill();
        g.lineWidth = hot ? 3 : 1.5;
        g.strokeStyle = hot ? '#ffe28a' : isMine && n > 0 ? 'rgba(255,215,130,.55)' : 'rgba(255,255,255,.14)';
        g.stroke();
        if (S.flash && S.flash.pit === idx && now - S.flash.t0 < 900) {
          g.strokeStyle = `rgba(255,255,255,${0.9 - (now - S.flash.t0) / 1000})`; g.lineWidth = 4; g.beginPath(); g.arc(p.cx, p.cy, r + 3, 0, Math.PI * 2); g.stroke();
        }
        stones(g, p.cx, p.cy, r, n, idx);
        g.fillStyle = n ? '#ffe9c2' : 'rgba(255,233,194,.45)';
        g.font = `700 ${Math.round(L.cell * 0.22)}px Inter,system-ui,sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        const top = owner !== botSide();
        g.fillText(String(n), p.cx, top ? p.cy - r - L.cell * 0.16 : p.cy + r + L.cell * 0.16);
        if (!top || mode === '2p') {
          g.fillStyle = 'rgba(255,233,194,.35)'; g.font = `600 ${Math.round(L.cell * 0.16)}px Inter,system-ui,sans-serif`;
          const label = String(top ? 6 - k : k + 1);
          if (!top) g.fillText(label, p.cx, p.cy + r + L.cell * 0.38);
        }
      }
      /* the hand */
      if (S.hand && S.hand.at !== undefined) {
        const p = slotAt(L, S.hand.at);
        g.fillStyle = '#fff'; g.font = `800 ${Math.round(L.cell * 0.2)}px Inter,system-ui,sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        if (S.hand.left > 0) g.fillText(`+${S.hand.left}`, p.cx, p.cy);
        g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 3;
        g.beginPath(); g.arc(p.cx, p.cy, L.cell * (p.store ? 0.34 : 0.43), 0, Math.PI * 2); g.stroke();
      }
      /* the keyboard's pit */
      if (S.kb && canAct()) {
        const p = slotAt(L, pitOf(mode === '2p' ? S.g.turn : me, S.cursor));
        g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 2; g.setLineDash([4, 4]);
        g.beginPath(); g.arc(p.cx, p.cy, L.cell * 0.46, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
      }
      g.restore();
    }

    /* ------------------------------ input ------------------------------ */
    const at = e => { const r = sf.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const seatToMove = () => (mode === '2p' ? S.g.turn : me);
    const onDown = e => {
      if (e.button > 0 || dead) return;
      snd.wake();
      S.kb = false;
      const p = at(e), hit = pitAt(p.x, p.y);
      if (hit === -1) return;
      if (hit.s !== S.g.turn && mode === '2p') { snd.blip(140, 0.08, 'sawtooth', 0.4); return; }
      S.hover = hit;
      tryPit(hit.k);
    };
    const onMove = e => {
      const p = at(e), hit = pitAt(p.x, p.y);
      if (S.kb) S.kb = false;
      const same = (hit === -1 && S.hover === -1) || (hit !== -1 && S.hover !== -1 && hit.s === S.hover.s && hit.k === S.hover.k);
      if (!same) { S.hover = hit; sf.cv.style.cursor = hit !== -1 && canAct() && hit.s === seatToMove() ? 'pointer' : 'default'; draw(); }
    };
    const onLeave = () => { if (S.hover !== -1) { S.hover = -1; draw(); } };
    S.hover = -1;
    const onKey = e => {
      if (!ownsKey(el, e) || dead || S.ended) return;
      const k = e.key;
      if (k === 'ArrowLeft' || k === 'ArrowRight') {
        e.preventDefault();
        snd.wake();
        S.kb = true;
        S.cursor = Math.max(0, Math.min(PITS - 1, S.cursor + (k === 'ArrowLeft' ? -1 : 1)));
        draw();
        return;
      }
      if (k === 'Enter' || k === ' ' || k === 'ArrowDown') { e.preventDefault(); snd.wake(); S.kb = true; tryPit(S.cursor); return; }
      if (/^[1-6]$/.test(k)) { e.preventDefault(); snd.wake(); S.cursor = Number(k) - 1; S.kb = true; tryPit(S.cursor); return; }
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
        S.timers.forEach(clearTimeout); S.timers.clear();
        if (paintT) cancelAnimationFrame(paintT);
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
      peek: () => {
        const L = S.geo;
        const slots = L ? Array.from({ length: 14 }, (_, i) => { const p = slotAt(L, i); return [Math.round(p.cx), Math.round(p.cy)]; }) : null;
        const o = S.over;
        return {
          mode, me: mode === '2p' ? null : me, turn: S.g.turn, board: Array.from(S.g.b), shown: Array.from(S.busy || S.q.length ? S.show : S.g.b),
          moves: S.g.moves.join(''), over: o ? { winner: o.winner, reason: o.reason || 'empty', score: o.score } : null,
          level: S.level, first: S.first, thinking: S.thinking, worker: !!brain?.worker, rejected: S.rejected,
          sowing: S.busy || S.q.length > 0, cursor: S.cursor, myMoves: S.myMoves, ended: S.ended, slots, status: statusEl.textContent,
          legal: legal(S.g), reduced,
        };
      },
    };
  },
};
