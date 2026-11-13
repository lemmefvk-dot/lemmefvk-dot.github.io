/* ============================================================
   arcade/go.js — Go on a 9 × 9 board for Static Arcade.

   Black and White put stones on the crossings; a group with no
   empty neighbour left is captured; suicide is forbidden; a simple
   ko stops an endless recapture; two passes in a row end the play,
   then the dead stones are marked and the board is scored by AREA
   (living stones + the empty points only you surround), White
   getting a komi of 7.5. The rules and the computer are in
   ./go-rules.js, which says exactly what was chosen.

   · 1P: against the computer (Easy, Medium, Hard), you or the
     computer first; both remembered in portal.arcadeGo. The search
     runs in a Web Worker so the page keeps drawing. After two
     passes the computer marks the stones it thinks are dead (shown
     faded with a cross); you press Accept to agree and score it, or
     Play on to keep playing. Undo takes back your last move and its
     reply.
   · 2P: Black and White take turns on one screen. After two passes
     either player clicks a group to mark it dead (or alive again)
     and presses Done; two Dones in a row, with no change between,
     agree the result. Play on goes back to the game.
   · Online: a friend on another device through the Arcade's room;
     the same rules. The host is Black (first) in odd rounds. Every
     arriving move (a point, a pass, a mark, Done, Play on) is checked
     by the rules engine, and whose turn it is, before it reaches
     the board.

   Mouse or touch: click a crossing (or, while scoring, a group).
   Keyboard: arrow keys move the cursor, Enter / Space play (or mark),
   P pass / Done, R play on, U / Z / Backspace undo.
   Score in 1P: a win scores the points you won by.
   ============================================================ */
import { h } from '../core/dom.js';
import { store } from '../core/store.js';
import * as R from './go-rules.js';
import { thinker } from './thinker.js';
import { KIT_CSS, surface, ownsKey, sounder, looper, playerStrip, segment, button, confirmButton, duelLink } from './boardkit.js';

const { N, AREA, PASS, RESUME, DEAD, KOMI, LEVELS } = R;
const PREF = 'portal.arcadeGo';
const LIGHT = '#f4f1e8', DARK = '#1b1c26';
const MIN_THINK_MS = 380;

const readPrefs = () => {
  let p = null;
  try { p = store.get(PREF, null); } catch (err) { p = null; }
  return { level: [1, 2, 3].includes(p?.level) ? p.level : 2, first: p?.first === 'cpu' ? 'cpu' : 'me' };
};
const writePrefs = patch => { try { store.set(PREF, { ...readPrefs(), ...patch }); } catch (err) { /* a convenience */ } };
const fmt = n => (Number.isInteger(n) ? String(n) : n.toFixed(1));

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
      g: R.newGame(), by: [], over: null, hover: -1, cursor: 40, kb: false, thinking: false, thinkId: 0,
      level: prefs.level, first: prefs.first, rejected: 0, myMoves: 0, ended: false, endT: 0, geo: { x: 0, y: 0, cell: 0 },
      shake: 0, placed: new Map(), flash: '', base: null,
    };
    const colorOf = v => (v === 1 ? DARK : LIGHT);
    const nameOf = v => (mode === '2p' ? (v === 1 ? 'Black' : 'White') : v === me ? 'You' : mode === 'cpu' ? 'The computer' : peerName);
    const colName = v => (v === 1 ? 'Black' : 'White');

    /* ------------------------------ the page ------------------------------ */
    const boardEl = h('div.arx-bg__board');
    const sr = h('div.arx-bg__sr', { 'aria-live': 'polite' });
    const statusEl = h('div.arx-bg__status', { role: 'status' });
    const countEl = h('div.arx-bg__note.arx-go__count', { 'aria-live': 'off' });
    const topStrip = playerStrip(LIGHT, '', '');
    const botStrip = playerStrip(DARK, '', '');
    const levelSeg = mode === 'cpu' ? segment('Level', [1, 2, 3].map(id => ({ id, label: LEVELS[id].name })), S.level, setLevel) : null;
    const firstSeg = mode === 'cpu' ? segment('First', [{ id: 'me', label: 'You (Black)' }, { id: 'cpu', label: 'Computer' }], S.first, setFirst) : null;
    const passBtn = button('Pass', 'skip-forward', () => { pass(); refocus(); }, { title: 'Pass (P)' });
    const resumeBtn = button('Play on', 'refresh', () => { resume(); refocus(); }, { title: 'Go back to playing (R)' });
    resumeBtn.hidden = true;
    const undoBtn = mode !== 'online' ? button('Undo', 'corner-up-left', () => { undo(); refocus(); }, { title: 'Take back the last move (U)' }) : null;
    const resignBtn = mode !== '2p' ? confirmButton('Resign', 'Resign? Click again', 'x', () => { resign(); refocus(); }) : null;
    const note = h('div.arx-bg__note', {
      text: (mode === 'online' ? 'Every move is checked on both screens. '
        : mode === '2p' ? 'Two players on this screen: Black goes first. '
          : 'Click a crossing, or use the arrow keys and Enter. ')
        + `9×9, area scoring, komi ${KOMI} for White, simple ko, no suicide. Two passes end the play; then dead stones are marked and both sides agree.`,
    });
    const side = h('div.arx-bg__side', topStrip.el, statusEl, countEl, levelSeg?.el, firstSeg?.el, h('div.arx-bg__row', passBtn, resumeBtn), h('div.arx-bg__row', undoBtn, resignBtn), note, botStrip.el);
    const root = h('div.arx-bgc', h('style', { text: KIT_CSS + '\n.arx-bg [hidden]{display:none!important}' }), h('div.arx-bg', boardEl, side), sr);
    el.appendChild(root);
    const sf = surface(boardEl, 'Go board', () => draw());
    const loop = looper(() => draw());
    const refocus = () => el.closest('[tabindex]')?.focus({ preventScroll: true });

    const link = NET ? duelLink(NET, {
      plies: () => S.g.moves.length,
      mine: i => S.by[i] === 'me',
      wire: i => ({ c: S.g.moves[i] }),
      take: d => {
        if (S.over || S.g.turn !== -me || !R.legal(S.g, d.c)) return false;
        apply(d.c, 'peer');
        return true;
      },
      reject: () => { S.rejected++; },
      resigned: () => {
        if (S.over) return;
        S.over = { winner: me, reason: 'resign', who: 'them' };
        say(`${peerName} resigned.`);
        paint();
        finishSoon();
      },
      dead: () => dead,
    }) : null;

    /* ------------------------------ rules glue ------------------------------ */
    const phase = () => S.g.phase;
    function newGame() {
      brain?.cancel();
      clearTimeout(S.endT);
      Object.assign(S, { g: R.newGame(), by: [], over: null, thinking: false, myMoves: 0, ended: false, cursor: 40, placed: new Map(), flash: '', base: null });
      S.thinkId++;
      ctx.onScore(0);
      NET?.peerScore?.(0);
      paint();
      if (mode === 'cpu' && S.g.turn !== me) computerMove();
    }
    const canAct = () => !dead && !S.over && !S.thinking && phase() !== 'over' && (mode === '2p' || S.g.turn === me);
    /* in a one-player game the scoring phase is the computer's judgement: Accept or Play on only */
    const marking = () => phase() === 'score' && mode !== 'cpu';

    function tryMove(m) {
      if (!canAct()) return false;
      if (!R.legal(S.g, m) || (phase() === 'score' && mode === 'cpu' && m !== PASS && m !== RESUME)) {
        S.shake = performance.now();
        S.flash = m >= 0 && m < AREA ? (S.g.b[m] ? 'That point is taken.' : m === S.g.ko ? 'Ko: you cannot retake at once.' : 'Not allowed: that would leave your stone with no liberty.') : '';
        if (S.flash) say(S.flash);
        snd.blip(140, 0.08, 'sawtooth', 0.4);
        loop.kick(0.25);
        paint();
        return false;
      }
      apply(m, 'me');
      link?.sendMove(S.g.moves.length - 1);
      return true;
    }

    function apply(m, by) {
      const g = S.g, v = g.turn;
      const was = g.phase, before = g.caps[0] + g.caps[1];
      if (mode === 'cpu' && was === 'score' && (m === PASS || m === RESUME)) {
        /* a one-player scoring phase: the computer agrees to what it proposed, or the game goes on with it to move */
        g.turn = me;
      }
      R.play(g, m);
      S.by.push(by);
      S.flash = '';
      if (by === 'me') S.myMoves++;
      if (m >= 0 && m < AREA) S.placed.set(m, performance.now());
      loop.kick(reduced ? 0.05 : 0.4);
      const took = g.caps[0] + g.caps[1] - before;
      snd.blip(took ? 200 : v === 1 ? 300 : 380, took ? 0.12 : 0.06, 'triangle', 0.7, took ? 120 : 0);
      if (g.phase === 'over') S.over = { winner: g.result.winner, reason: 'score', result: g.result };
      const what = m === PASS ? (was === 'score' ? 'is done marking' : 'passed') : m === RESUME ? 'wants to play on' : m >= DEAD ? `toggled the group at ${R.pointName(m - DEAD)}` : `played ${R.pointName(m)}${took ? `, capturing ${took}` : ''}`;
      say(`${nameOf(v)} ${what}.${S.over ? ' ' + overText() : ''}`);
      /* the computer's agreement in a one-player scoring phase */
      if (mode === 'cpu' && was === 'score' && m === PASS && !S.over && g.phase === 'score') { R.play(g, PASS); S.by.push('cpu'); S.over = { winner: g.result.winner, reason: 'score', result: g.result }; }
      if (mode === 'cpu' && was === 'score' && m === RESUME) { paint(); computerMove(); return; }
      paint();
      if (S.over) { loop.kick(2.5); finishSoon(); return; }
      if (mode === 'cpu' && g.phase === 'score' && was === 'play') { enterScoring(); return; }
      if (mode === 'cpu' && g.phase === 'play' && g.turn !== me) computerMove();
    }

    async function computerMove() {
      const id = ++S.thinkId;
      S.thinking = true;
      paint();
      const t0 = performance.now();
      const res = await brain.ask({ game: 'go', moves: S.g.moves.slice(), turn: S.g.turn, level: S.level, ...(S.base ? { base: S.base } : {}) });
      if (dead || id !== S.thinkId) return;
      const wait = MIN_THINK_MS - (performance.now() - t0);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      if (dead || id !== S.thinkId) return;
      S.thinking = false;
      if (!res || !R.legal(S.g, res.move)) {
        statusEl.textContent = 'The computer could not move. Press Undo or start again.';
        statusEl.classList.add('is-alert');
        paint();
        return;
      }
      apply(res.move, 'cpu');
    }

    /* both sides passed against the computer: it marks what it thinks is dead */
    async function enterScoring() {
      const id = ++S.thinkId;
      S.thinking = true;
      S.g.turn = me;
      paint();
      const res = await brain.ask({ game: 'go', moves: S.g.moves.slice(), dead: true, ...(S.base ? { base: S.base } : {}) });
      if (dead || id !== S.thinkId) return;
      S.thinking = false;
      if (S.g.phase === 'score') R.setDead(S.g, res?.dead || []);
      say(S.g.dead.some(Boolean) ? 'The computer marked the dead stones.' : 'The computer sees no dead stones.');
      paint();
      loop.kick(0.4);
    }

    function pass() { tryMove(PASS); }
    function resume() { if (phase() === 'score') tryMove(RESUME); }

    function undo() {
      if (mode === 'online' || S.over || dead) return;
      const g = S.g;
      if (mode === '2p') {
        if (!g.moves.length) return;
        R.undo(g); S.by.pop();
      } else {
        const mine = S.by.lastIndexOf('me');
        if (mine < 0) return;
        if (S.thinking) { brain.cancel(); S.thinkId++; S.thinking = false; }
        while (g.moves.length > mine) { R.undo(g); if (S.by.pop() === 'me') S.myMoves--; }
        if (phase() === 'play' && g.turn !== me && mode === 'cpu') g.turn = me;
      }
      S.placed.clear();
      S.flash = '';
      snd.blip(330, 0.07, 'triangle', 0.6, 220);
      say('Move taken back.');
      paint();
    }

    function resign() {
      if (S.over || dead) return;
      if (S.thinking) { brain?.cancel(); S.thinkId++; S.thinking = false; }
      S.over = { winner: -me, reason: 'resign', who: 'me' };
      link?.resign();
      say('You resigned.');
      paint();
      finishSoon();
    }

    function finishSoon() {
      clearTimeout(S.endT);
      S.endT = setTimeout(finish, reduced ? 300 : 1200);
    }
    function scoreText(r) { return `Black ${r.black}, White ${r.white} + ${r.komi} komi`; }
    function finish() {
      if (S.ended || dead || !S.over) return;
      S.ended = true;
      paint();
      const o = S.over, r = o.result;
      const margin = r ? Math.abs(r.margin) : 0;
      if (mode === 'online') {
        const won = o.winner === me;
        const detail = o.reason === 'resign' ? (o.who === 'me' ? 'You resigned.' : `${peerName} resigned.`)
          : `${colName(o.winner)} wins by ${fmt(margin)} (${scoreText(r)}). You played ${colName(me)}.`;
        ctx.onEnd({ score: null, won, versus: { me: won ? 1 : 0, them: won ? 0 : 1 }, detail });
        return;
      }
      if (mode === '2p') {
        ctx.onEnd({ score: null, detail: o.reason === 'resign' ? `${nameOf(o.winner)} wins by resignation.` : `${colName(o.winner)} wins by ${fmt(margin)} (${scoreText(r)}).` });
        return;
      }
      const lv = LEVELS[S.level].name;
      if (o.winner === me && o.reason === 'score') ctx.onEnd({ score: Math.max(0, Math.round(margin)), won: true, detail: `You won by ${fmt(margin)} against the computer (${lv}): ${scoreText(r)}.` });
      else if (o.winner === me) ctx.onEnd({ score: null, won: true, detail: `The computer (${lv}) resigned.` });
      else ctx.onEnd({ score: null, won: false, detail: o.reason === 'resign' ? `You resigned against the computer (${lv}).` : `The computer (${lv}) won by ${fmt(margin)}: ${scoreText(r)}.` });
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
      if (mode === '2p') return o.reason === 'resign' ? `${nameOf(o.winner)} wins by resignation.` : `${colName(o.winner)} wins by ${fmt(Math.abs(o.result.margin))}.`;
      if (o.reason === 'resign') return o.who === 'me' ? 'You resigned.' : `${peerName} resigned — you win.`;
      return o.winner === me ? `You win by ${fmt(Math.abs(o.result.margin))}!` : `${mode === 'cpu' ? 'The computer' : peerName} wins by ${fmt(Math.abs(o.result.margin))}.`;
    }
    function say(t) { sr.textContent = t; }

    function liveScore() { return R.score(S.g); }
    function paint() {
      if (dead) return;
      const g = S.g, ph = phase();
      let text;
      if (S.over) text = overText();
      else if (ph === 'score') {
        if (mode === 'cpu') text = S.thinking ? 'The computer is marking the dead stones…' : 'Dead stones are marked. Accept to score, or Play on.';
        else text = g.turn === me || mode === '2p' ? `${nameOf(g.turn)}: click a group to mark it dead, then Done.` : `${nameOf(g.turn)} is marking the dead stones…`;
      } else if (mode === 'cpu') text = g.turn === me ? 'Your move' : 'The computer is thinking…';
      else if (mode === '2p') text = `${nameOf(g.turn)} to move`;
      else text = g.turn === me ? 'Your move' : `${peerName}’s move`;
      if (S.flash && !S.over) text = S.flash;
      statusEl.textContent = text;
      statusEl.classList.toggle('is-alert', !!S.flash && !S.over);
      statusEl.classList.toggle('is-done', !!S.over);
      const topV = mode === '2p' ? -1 : -me, botV = mode === '2p' ? 1 : me;
      const sub = v => `${colName(v)}${v === 1 ? ', first' : `, komi ${KOMI}`} · captured ${g.caps[v === 1 ? 0 : 1]}`;
      topStrip.set({ name: mode === '2p' ? colName(topV) : mode === 'cpu' ? 'Computer' : peerName, note: mode === 'cpu' ? `${LEVELS[S.level].name} · ${sub(topV)}` : sub(topV),
        color: colorOf(topV), turn: !S.over && g.turn === topV && ph !== 'over', thinking: S.thinking });
      botStrip.set({ name: mode === '2p' ? colName(botV) : 'You', note: sub(botV), color: colorOf(botV), turn: !S.over && g.turn === botV && ph !== 'over' });
      passBtn.setLabel(ph === 'score' ? (mode === 'cpu' ? 'Accept' : 'Done') : 'Pass');
      passBtn.title = ph === 'score' ? (mode === 'cpu' ? 'Agree and score the game (P)' : 'I am happy with the marks (P)') : 'Pass (P)';
      passBtn.disabled = !canAct();
      resumeBtn.hidden = ph !== 'score';
      resumeBtn.disabled = !canAct();
      if (undoBtn) undoBtn.disabled = !!S.over || (mode === '2p' ? !g.moves.length : !S.by.includes('me'));
      if (resignBtn) { resignBtn.disabled = !!S.over; if (S.over) resignBtn.reset(); }
      if (ph === 'score' || ph === 'over') { const sc = liveScore(); countEl.textContent = `Area: Black ${sc.black} · White ${sc.white} + ${sc.komi} komi = ${fmt(sc.white + sc.komi)} (Black ${sc.margin > 0 ? 'ahead' : 'behind'} by ${fmt(Math.abs(sc.margin))})`; }
      else countEl.textContent = g.passes ? `${colName(-g.turn)} passed. If you pass too, the game goes to scoring.` : `Move ${g.moves.length + 1}`;
      sf.cv.setAttribute('aria-label', `Go board. ${text}`);
      ctx.onScore(mode === '2p' ? g.moves.length : S.myMoves);
      if (NET) NET.peerScore?.(S.by.filter(b => b === 'peer').length);
      draw();
    }

    /* ------------------------------ drawing ------------------------------ */
    function layout() {
      const cell = Math.max(12, Math.floor(Math.min(sf.w, sf.h) / (N + 0.9)));
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
      const span = L.cell * (N - 1), pad = L.cell * 0.75;
      const bg = g.createLinearGradient(L.x, L.y, L.x + span, L.y + span);
      bg.addColorStop(0, '#3a4a78');
      bg.addColorStop(1, '#222c52');
      g.save();
      g.shadowBlur = 26;
      g.shadowColor = 'hsla(225,90%,60%,.4)';
      g.fillStyle = bg;
      g.fillRect(L.x - pad, L.y - pad, span + pad * 2, span + pad * 2);
      g.restore();
      g.strokeStyle = 'rgba(205,218,255,.55)';
      g.lineWidth = 1;
      g.beginPath();
      for (let k = 0; k < N; k++) {
        g.moveTo(L.x + k * L.cell + 0.5, L.y); g.lineTo(L.x + k * L.cell + 0.5, L.y + span);
        g.moveTo(L.x, L.y + k * L.cell + 0.5); g.lineTo(L.x + span, L.y + k * L.cell + 0.5);
      }
      g.stroke();
      g.fillStyle = 'rgba(210,222,255,.75)';
      for (const [r, c] of [[2, 2], [2, 6], [6, 2], [6, 6], [4, 4]]) { g.beginPath(); g.arc(L.x + c * L.cell, L.y + r * L.cell, Math.max(2, L.cell * 0.08), 0, Math.PI * 2); g.fill(); }
      const Rd = L.cell * 0.46;
      const showTerr = phase() === 'score' || phase() === 'over';
      const sc = showTerr ? liveScore() : null;
      /* territory squares (scoring) */
      if (sc) {
        for (let i = 0; i < AREA; i++) {
          if (S.g.b[i] && !S.g.dead[i]) continue;
          const o = sc.owner[i];
          if (!o) continue;
          g.fillStyle = o === 1 ? 'rgba(10,10,20,.8)' : 'rgba(250,248,240,.85)';
          const q = L.cell * 0.2;
          g.fillRect(px(L, i) - q, py(L, i) - q, q * 2, q * 2);
        }
      }
      /* the stones */
      for (let i = 0; i < AREA; i++) {
        const v = S.g.b[i];
        if (!v) continue;
        const t0 = S.placed.get(i);
        const k = !reduced && t0 ? Math.min(1, (now - t0) / 140) : 1;
        const isDead = !!S.g.dead[i];
        stone(g, px(L, i), py(L, i), Rd * (0.6 + 0.4 * k), colorOf(v), (isDead ? 0.4 : 1) * (0.4 + 0.6 * k));
        if (isDead) {
          g.strokeStyle = '#ff4d6d'; g.lineWidth = Math.max(2, L.cell * 0.07);
          const q = Rd * 0.55;
          g.beginPath(); g.moveTo(px(L, i) - q, py(L, i) - q); g.lineTo(px(L, i) + q, py(L, i) + q); g.moveTo(px(L, i) + q, py(L, i) - q); g.lineTo(px(L, i) - q, py(L, i) + q); g.stroke();
        }
      }
      /* the last move, and the ko point */
      if (S.g.last >= 0 && phase() === 'play') {
        g.strokeStyle = '#ff4d6d'; g.lineWidth = Math.max(2, L.cell * 0.07);
        g.beginPath(); g.arc(px(L, S.g.last), py(L, S.g.last), Rd * 0.45, 0, Math.PI * 2); g.stroke();
      }
      if (S.g.ko >= 0 && phase() === 'play') {
        g.strokeStyle = '#ffd23f'; g.lineWidth = Math.max(2, L.cell * 0.07);
        const q = Rd * 0.5;
        g.strokeRect(px(L, S.g.ko) - q, py(L, S.g.ko) - q, q * 2, q * 2);
      }
      /* the stone waiting under the pointer / the keyboard cursor */
      const at = S.kb ? S.cursor : S.hover;
      if (at >= 0 && canAct()) {
        if (phase() === 'play' && S.g.b[at] === 0 && R.legal(S.g, at)) stone(g, px(L, at), py(L, at), Rd, colorOf(S.g.turn), 0.45);
        if (marking() && S.g.b[at]) { g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 2; g.beginPath(); g.arc(px(L, at), py(L, at), Rd * 1.1, 0, Math.PI * 2); g.stroke(); }
        if (S.kb) {
          g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 2; g.setLineDash([4, 4]);
          g.strokeRect(px(L, at) - L.cell * 0.5, py(L, at) - L.cell * 0.5, L.cell, L.cell);
          g.setLineDash([]);
        }
      }
      if (S.shake && now - S.shake < 220 && at >= 0) {
        g.strokeStyle = `rgba(255,90,110,${1 - (now - S.shake) / 220})`; g.lineWidth = 3;
        g.beginPath(); g.arc(px(L, at), py(L, at), Rd, 0, Math.PI * 2); g.stroke();
      }
    }

    /* ------------------------------ input ------------------------------ */
    const clickPoint = i => {
      if (i < 0) return;
      if (phase() === 'score') { if (marking() && S.g.b[i]) tryMove(DEAD + i); return; }
      tryMove(i);
    };
    const at = e => { const r = sf.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const onDown = e => {
      if (e.button > 0 || dead) return;
      snd.wake();
      S.kb = false;
      const p = at(e), i = pointAt(p.x, p.y);
      if (i < 0) return;
      S.hover = i;
      clickPoint(i);
    };
    const onMove = e => {
      const p = at(e), i = pointAt(p.x, p.y);
      S.kb = false;
      if (i !== S.hover) { S.hover = i; sf.cv.style.cursor = i >= 0 && canAct() ? 'pointer' : 'default'; draw(); }
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
      if (k === 'Enter' || k === ' ') { e.preventDefault(); snd.wake(); S.kb = true; clickPoint(S.cursor); return; }
      if (k === 'p' || k === 'P') { e.preventDefault(); snd.wake(); pass(); return; }
      if (k === 'r' || k === 'R') { e.preventDefault(); resume(); return; }
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
      /* test hook (inert unless a test calls it): 'setup' loads a position { rows, turn, passes } to play on from */
      hook(cmd, arg) {
        if (cmd !== 'setup') return false;
        brain?.cancel();
        S.thinkId++;
        clearTimeout(S.endT);
        const g0 = R.fromRows(arg.rows, arg.turn || 1);
        g0.passes = arg.passes | 0;
        S.g = g0;
        Object.assign(S, { by: [], over: null, thinking: false, myMoves: 0, ended: false, placed: new Map(), flash: '', base: { b: Array.from(g0.b), turn: g0.turn, ko: -1, passes: g0.passes } });
        paint();
        if (mode === 'cpu' && S.g.turn !== me) computerMove();
        return true;
      },
      /* what a watcher may see (./spectate.js): B = black (moves first), W = white */
      spectate: () => ({
        k: 'board', st: 'go', w: N, h: N, cells: Array.from(S.g.b, v => (v === 1 ? 'B' : v === -1 ? 'W' : '.')).join(''),
        hl: [], txt: statusEl.textContent, over: !!S.over, turn: S.over ? 0 : S.g.turn,
        pl: [{ n: nameOf(1), m: 'Black' }, { n: nameOf(-1), m: 'White' }],
      }),
      peek: () => {
        const id = v => (v === 1 ? 1 : v === -1 ? 2 : 0);
        const rows = [], deadRows = [];
        for (let r = 0; r < N; r++) {
          let s = '', d = '';
          for (let c = 0; c < N; c++) { const v = S.g.b[r * N + c]; s += v === 1 ? 'x' : v === -1 ? 'o' : '.'; d += S.g.dead[r * N + c] ? '#' : '.'; }
          rows.push(s); deadRows.push(d);
        }
        const sc = phase() !== 'play' ? R.score(S.g) : null;
        return {
          mode, me: mode === '2p' ? null : id(me), turn: id(S.g.turn), phase: phase(), rows, dead: deadRows, ko: S.g.ko, caps: S.g.caps.slice(), passes: S.g.passes,
          moves: S.g.moves.slice(), over: S.over ? { winner: id(S.over.winner), reason: S.over.reason } : null,
          score: sc ? { black: sc.black, white: sc.white, margin: sc.margin } : null, level: S.level, first: S.first, thinking: S.thinking,
          worker: !!brain?.worker, rejected: S.rejected, cursor: S.cursor, myMoves: S.myMoves, ended: S.ended, geo: { ...S.geo }, status: statusEl.textContent,
          passLabel: passBtn.textContent.trim(),
        };
      },
    };
  },
};
