/* ============================================================
   arcade/domino.js — Dominoes against the computer, for Static Arcade.

   The double-six draw game (rules in ./domino-rules.js, repeated in
   the game's note): seven tiles each, play a tile whose number
   matches an end of the line, draw from the boneyard when you
   cannot, pass when the boneyard is empty. Going out scores the
   pips left in the computer's hand; a blocked game goes to the side
   with fewer pips for the difference. First to the target (25, 50
   or 100; remembered in portal.arcadeDominoes) wins the match.

   The computer (Easy, Medium, Hard) answers from a Web Worker. It
   is only ever shown its own hand, the line and the boneyard's size
   (./domino-rules.js viewFor), never yours. Undo takes back your
   last move (and everything the computer did after it) within the
   round; a taken-back draw puts the same tile back on the pile.

   Mouse or touch: click a tile in your hand. If it fits one end it
   goes there; if it fits both, pick Left or Right. Click the boneyard
   (or Draw) when you have nothing to play, Pass when the boneyard is
   empty. Keyboard: ← → pick a tile, Enter / Space play it (with both
   ends open, ← → choose the end and Enter again; ↑ cancels), D draw,
   P pass, N next round, U / Z / Backspace undo.
   Score: your points when you win the match.
   ============================================================ */
import { h } from '../core/dom.js';
import { store } from '../core/store.js';
import * as R from './domino-rules.js';
import { thinker } from './thinker.js';
import { KIT_CSS, surface, ownsKey, sounder, looper, rr, playerStrip, segment, button, confirmButton } from './boardkit.js';

const { TILES } = R;
const PREF = 'portal.arcadeDominoes';
const IVORY = '#f3efe2', INK = '#1c1f33';

const readPrefs = () => {
  let p = null;
  try { p = store.get(PREF, null); } catch (err) { p = null; }
  return { level: [1, 2, 3].includes(p?.level) ? p.level : 2, target: [25, 50, 100].includes(p?.target) ? p.target : 50 };
};
const writePrefs = patch => { try { store.set(PREF, { ...readPrefs(), ...patch }); } catch (err) { /* a convenience */ } };
const cryptoRnd = () => { const a = new Uint32Array(1); (globalThis.crypto || crypto).getRandomValues(a); return a[0] / 4294967296; };
const seeded = seed => { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PIPS = { 0: [], 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]] };

export default {
  mount(el, ctx) {
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    const brain = thinker();
    const prefs = readPrefs();
    let dead = false;
    let rnd = cryptoRnd;
    const hue = Number(getComputedStyle(el).getPropertyValue('--h')) || 200;

    const S = {
      g: null, level: prefs.level, target: prefs.target, thinking: false, runId: 0, undo: [], sel: -1, side: 'L', cursor: 0,
      ended: false, endT: 0, flash: '', shake: 0, lastPlay: -1, geo: {}, hover: null, matchOver: false,
    };

    /* ------------------------------ the page ------------------------------ */
    const boardEl = h('div.arx-bg__board');
    const sr = h('div.arx-bg__sr', { 'aria-live': 'polite' });
    const statusEl = h('div.arx-bg__status', { role: 'status' });
    const topStrip = playerStrip('#ff8a4d', 'Computer', '');
    const botStrip = playerStrip('#4dd2ff', 'You', '');
    const levelSeg = segment('Level', [1, 2, 3].map(id => ({ id, label: R.LEVELS[id].name })), S.level, v => { S.level = v; writePrefs({ level: v }); levelSeg.set(v); paint(); refocus(); });
    const targetSeg = segment('Play to', [25, 50, 100].map(id => ({ id, label: String(id) })), S.target, v => { if (v !== S.target) { S.target = v; writePrefs({ target: v }); targetSeg.set(v); newMatch(); } refocus(); });
    const drawBtn = button('Draw', 'download', () => { draw1(); refocus(); }, { title: 'Draw a tile from the boneyard (D)' });
    const passBtn = button('Pass', 'skip-forward', () => { pass(); refocus(); }, { title: 'Pass: nothing fits and the boneyard is empty (P)' });
    const nextBtn = button('Next round', 'arrow-right', () => { nextRound(); refocus(); }, { title: 'Deal the next round (N)' });
    nextBtn.hidden = true;
    const undoBtn = button('Undo', 'corner-up-left', () => { undo(); refocus(); }, { title: 'Take back your last move (U)' });
    const resignBtn = confirmButton('Give up', 'Give up? Click again', 'x', () => { giveUp(); refocus(); });
    const note = h('div.arx-bg__note', {
      text: 'Double-six, draw game. Match a number at either end; draw when you cannot play, pass when the boneyard is empty. Going out scores the pips left in the other hand; a blocked game goes to the side with fewer pips, for the difference. First to the target wins.',
    });
    const side = h('div.arx-bg__side', topStrip.el, statusEl, levelSeg.el, targetSeg.el, h('div.arx-bg__row', drawBtn, passBtn, nextBtn), h('div.arx-bg__row', undoBtn, resignBtn), note, botStrip.el);
    const root = h('div.arx-bgc', h('style', { text: KIT_CSS + '\n.arx-bg [hidden]{display:none!important}' }), h('div.arx-bg', boardEl, side), sr);
    el.appendChild(root);
    const sf = surface(boardEl, 'Dominoes table', () => paintCanvas());
    const loop = looper(() => paintCanvas());
    const refocus = () => el.closest('[tabindex]')?.focus({ preventScroll: true });

    /* ------------------------------ rules glue ------------------------------ */
    const g = () => S.g;
    const myTurn = () => !dead && g().phase === 'play' && g().turn === 0 && !S.thinking;
    const legalNow = () => (myTurn() ? R.moves(g()) : []);
    const sidesOf = id => legalNow().filter(m => m.k === 'play' && m.id === id).map(m => m.side);
    const mustDraw = () => legalNow().some(m => m.k === 'draw');
    const mustPass = () => legalNow().some(m => m.k === 'pass');

    function newMatch() {
      clearTimeout(S.endT);
      S.runId++;
      brain.cancel();
      S.matchOver = false;
      S.ended = false;
      S.g = R.deal(rnd, null, S.target);
      startRound();
    }
    function nextRound() {
      if (g().phase !== 'round') return;
      S.runId++;
      S.g = R.deal(rnd, g(), S.target);
      startRound();
    }
    function startRound() {
      Object.assign(S, { undo: [], sel: -1, side: 'L', thinking: false, flash: '', lastPlay: -1, cursor: 0 });
      const gg = g();
      const [a, b] = TILES[gg.opened];
      say(`Round ${gg.round}. ${gg.turn === 0 ? 'You hold' : 'The computer holds'} the highest ${a === b ? 'double' : 'tile'} (${a}-${b}) and leads it.`);
      ctx.onScore(gg.scores[0]);
      paint();
      if (gg.turn === 1) computerTurns();
    }

    function snapshot() { S.undo.push(R.copy(g())); if (S.undo.length > 60) S.undo.shift(); }

    function flash(t) { S.flash = t; S.shake = performance.now(); snd.blip(140, 0.08, 'sawtooth', 0.4); loop.kick(0.25); paint(); return false; }

    function play(id, side) {
      if (!myTurn()) return false;
      if (!sidesOf(id).includes(side)) return flash(sidesOf(id).length ? 'That tile does not fit that end.' : 'That tile does not fit either end.');
      snapshot();
      commit({ k: 'play', id, side });
      return true;
    }
    function draw1() {
      if (!myTurn()) return false;
      if (!mustDraw()) return flash(mustPass() ? 'The boneyard is empty: pass.' : 'You have a tile to play, so you cannot draw.');
      snapshot();
      commit({ k: 'draw' });
      return true;
    }
    function pass() {
      if (!myTurn()) return false;
      if (!mustPass()) return flash(mustDraw() ? 'Draw from the boneyard first.' : 'You have a tile to play.');
      snapshot();
      commit({ k: 'pass' });
      return true;
    }
    function commit(m) {
      const gg = g(), side = gg.turn;
      const who = side === 0 ? 'You' : 'The computer';
      R.apply(gg, m);
      S.sel = -1;
      S.flash = '';
      if (m.k === 'play') { S.lastPlay = m.id; const [a, b] = TILES[m.id]; say(`${who} played ${a}-${b} on the ${gg.chain.length === 1 ? 'table' : m.side === 'L' ? 'left' : 'right'}.`); snd.blip(240 + R.pips(m.id) * 12, 0.07, 'triangle', 0.8); }
      else if (m.k === 'draw') { say(`${who} drew from the boneyard.`); snd.blip(180, 0.06, 'square', 0.5, 240); }
      else { say(`${who} passed.`); snd.blip(150, 0.08, 'sine', 0.5); }
      loop.kick(reduced ? 0.05 : 0.5);
      if (gg.phase !== 'play') { roundEnded(); return; }
      paint();
      if (gg.turn === 1 && side === 0) computerTurns();
    }

    async function computerTurns() {
      const run = ++S.runId;
      const alive = () => !dead && run === S.runId;
      S.thinking = true;
      paint();
      while (alive() && g().phase === 'play' && g().turn === 1) {
        const t0 = performance.now();
        const res = await brain.ask({ game: 'domino', view: R.viewFor(g(), 1), level: S.level });
        if (!alive()) return;
        const wait = (reduced ? 140 : 620) - (performance.now() - t0);
        if (wait > 0) await sleep(wait);
        if (!alive()) return;
        const m = res?.mv;
        if (!m || !R.isLegal(g(), m)) {
          const fallback = R.moves(g())[0];
          S.thinking = false;
          commit(fallback);
          S.thinking = true;
          if (!alive()) return;
          continue;
        }
        S.thinking = false;
        commit(m);
        S.thinking = true;
      }
      if (alive()) { S.thinking = false; paint(); }
    }

    function roundEnded() {
      const gg = g(), r = gg.result;
      S.thinking = false;
      S.runId++;
      brain.cancel();
      const text = roundText();
      say(text);
      snd.blip(r.winner === 0 ? 520 : 220, 0.14, 'triangle', 0.9, r.winner === 0 ? 780 : 150);
      ctx.onScore(gg.scores[0]);
      paint();
      loop.kick(1.2);
      if (gg.phase === 'over') { S.matchOver = true; finishSoon(); }
    }

    function undo() {
      if (dead || S.matchOver || g().phase === 'over') return;
      const prev = S.undo.pop();
      if (!prev) return;
      S.runId++;
      brain.cancel();
      S.thinking = false;
      S.g = prev;
      S.sel = -1;
      S.flash = '';
      S.lastPlay = -1;
      snd.blip(330, 0.07, 'triangle', 0.6, 220);
      say('Move taken back.');
      paint();
    }

    function giveUp() {
      if (dead || S.matchOver) return;
      S.runId++;
      brain.cancel();
      S.thinking = false;
      S.matchOver = true;
      g().phase = 'over';
      g().result = { winner: 1, pts: 0, how: 'gaveup', left: [0, 0], matchOver: true, matchWinner: 1 };
      say('You gave up the match.');
      paint();
      finishSoon();
    }

    function finishSoon() {
      clearTimeout(S.endT);
      S.endT = setTimeout(finish, reduced ? 300 : 1500);
    }
    function finish() {
      if (S.ended || dead || !S.matchOver) return;
      S.ended = true;
      paint();
      const gg = g(), mine = gg.scores[0], theirs = gg.scores[1], lv = R.LEVELS[S.level].name;
      const won = gg.result.matchWinner === 0;
      ctx.onEnd(won ? { score: mine, won: true, detail: `You won the match ${mine} to ${theirs} in ${gg.round} rounds against the computer (${lv}, first to ${gg.target}).` }
        : gg.result.how === 'gaveup' ? { score: null, won: false, detail: `You gave up at ${mine} to ${theirs} against the computer (${lv}).` }
          : { score: null, won: false, detail: gg.result.matchWinner < 0 ? `The match ended level at ${mine} each against the computer (${lv}).` : `The computer (${lv}) won the match ${theirs} to ${mine}.` });
    }

    /* ------------------------------ text ------------------------------ */
    function say(t) { sr.textContent = t; }
    function roundText() {
      const r = g().result, gg = g();
      if (!r) return '';
      if (r.how === 'gaveup') return 'You gave up the match.';
      let t;
      if (r.how === 'domino') t = r.winner === 0 ? `You went out and score ${r.pts} (the computer had ${r.left[1]} pips left).` : `The computer went out and scores ${r.pts} (you had ${r.left[0]} pips left).`;
      else if (r.winner < 0) t = `Blocked: ${r.left[0]} pips each. Nobody scores.`;
      else t = `Blocked: you have ${r.left[0]} pips, the computer ${r.left[1]}. ${r.winner === 0 ? 'You score' : 'The computer scores'} ${r.pts}.`;
      if (gg.phase === 'over') t += r.matchWinner === 0 ? ' You win the match!' : r.matchWinner === 1 ? ' The computer wins the match.' : ' The match is level.';
      return t;
    }

    function paint() {
      if (dead) return;
      const gg = g(), ph = gg.phase;
      let text;
      if (ph === 'round' || ph === 'over') text = roundText();
      else if (S.thinking) text = 'The computer is thinking…';
      else if (gg.turn === 0) {
        if (mustDraw()) text = 'Nothing fits: draw from the boneyard (click it, or press D).';
        else if (mustPass()) text = 'Nothing fits and the boneyard is empty: pass (P).';
        else if (!gg.chain.length) text = `Lead the ${TILES[gg.opened].join('-')}.`;
        else if (S.sel >= 0) text = 'Choose which end: Left or Right.';
        else text = 'Your move: pick a tile.';
      } else text = 'The computer is thinking…';
      if (S.flash && ph === 'play') text = S.flash;
      statusEl.textContent = text;
      statusEl.classList.toggle('is-alert', !!S.flash && ph === 'play');
      statusEl.classList.toggle('is-done', ph !== 'play');
      topStrip.set({ note: `${gg.scores[1]} points · ${gg.hands[1].length} tiles · ${R.LEVELS[S.level].name}`, turn: ph === 'play' && gg.turn === 1, thinking: S.thinking });
      botStrip.set({ note: `${gg.scores[0]} points · ${gg.hands[0].length} tiles · round ${gg.round}, first to ${gg.target}`, turn: ph === 'play' && gg.turn === 0 });
      drawBtn.disabled = !myTurn() || !mustDraw();
      passBtn.disabled = !myTurn() || !mustPass();
      nextBtn.hidden = ph !== 'round';
      drawBtn.hidden = ph === 'round';
      passBtn.hidden = ph === 'round';
      undoBtn.disabled = S.matchOver || !S.undo.length;
      resignBtn.disabled = S.matchOver;
      if (S.matchOver) resignBtn.reset();
      sf.cv.setAttribute('aria-label', `Dominoes table. ${text} Your hand: ${gg.hands[0].map(id => TILES[id].join('-')).join(', ') || 'empty'}. Line: ${gg.chain.map(c => `${c.l}-${c.r}`).join(' ') || 'empty'}.`);
      paintCanvas();
    }

    /* ------------------------------ drawing ------------------------------ */
    function tile(c, x, y, w, hgt, a, b, o = {}) {
      c.save();
      if (o.glow) { c.shadowColor = o.glow; c.shadowBlur = hgt * 0.25; }
      else { c.shadowColor = 'rgba(0,0,0,.5)'; c.shadowBlur = Math.min(w, hgt) * 0.2; c.shadowOffsetY = Math.min(w, hgt) * 0.08; }
      c.globalAlpha = o.alpha ?? 1;
      if (o.back) {
        const gr = c.createLinearGradient(x, y, x + w, y + hgt);
        gr.addColorStop(0, '#34406f'); gr.addColorStop(1, '#1d2547');
        c.fillStyle = gr;
      } else c.fillStyle = o.dim ? '#c9c5b8' : IVORY;
      rr(c, x, y, w, hgt, Math.min(w, hgt) * 0.16); c.fill();
      c.shadowBlur = 0; c.shadowOffsetY = 0;
      if (o.edge) { c.strokeStyle = o.edge; c.lineWidth = 2.5; rr(c, x, y, w, hgt, Math.min(w, hgt) * 0.16); c.stroke(); }
      if (!o.back) {
        const horiz = w > hgt, hw = horiz ? w / 2 : w, hh = horiz ? hgt : hgt / 2;
        c.strokeStyle = 'rgba(28,31,51,.45)'; c.lineWidth = 1.5;
        c.beginPath();
        if (horiz) { c.moveTo(x + w / 2, y + hgt * 0.12); c.lineTo(x + w / 2, y + hgt * 0.88); } else { c.moveTo(x + w * 0.12, y + hgt / 2); c.lineTo(x + w * 0.88, y + hgt / 2); }
        c.stroke();
        c.fillStyle = INK;
        const pr = Math.min(hw, hh) * 0.09, sp = Math.min(hw, hh) * 0.25;
        for (const [half, v] of [[0, a], [1, b]]) {
          const cx = horiz ? x + hw * (half + 0.5) : x + hw / 2, cy = horiz ? y + hh / 2 : y + hh * (half + 0.5);
          for (const [dx, dy] of PIPS[v]) { c.beginPath(); c.arc(cx + dx * sp, cy + dy * sp, pr, 0, Math.PI * 2); c.fill(); }
        }
      } else {
        c.strokeStyle = 'rgba(160,180,255,.25)'; c.lineWidth = 1.5;
        rr(c, x + w * 0.12, y + hgt * 0.12, w * 0.76, hgt * 0.76, Math.min(w, hgt) * 0.1); c.stroke();
      }
      c.restore();
    }

    function chainLayout(W, top, bottom) {
      const gap = 5;
      let a = 14, perRow = 1;
      for (let t = 46; t >= 14; t -= 2) {
        const pr = Math.max(1, Math.floor((W - 24 + gap) / (2 * t + gap)));
        const rows = Math.ceil(28 / pr);
        if (rows * (t + gap) <= bottom - top) { a = t; perRow = pr; break; }
        a = t; perRow = pr;
      }
      const step = 2 * a + gap, x0 = (W - (perRow * step - gap)) / 2;
      return { a, perRow, step, x0, gap, y0: top };
    }

    function paintCanvas() {
      if (dead || !S.g) return;
      const c = sf.g, W = sf.w, H = sf.h, gg = g();
      sf.begin();
      const now = performance.now();
      c.fillStyle = '#05060d'; c.fillRect(0, 0, W, H);
      const glow = c.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, Math.max(W, H) * 0.7);
      glow.addColorStop(0, `hsla(${hue},65%,34%,.3)`); glow.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = glow; c.fillRect(0, 0, W, H);

      /* the computer's hand across the top, the boneyard at its right */
      const topH = Math.max(34, Math.min(76, H * 0.15));
      const oa = Math.max(10, Math.min(topH * 0.5, (W - 150) / (Math.max(7, gg.hands[1].length) * 1.2)));
      const reveal = gg.phase !== 'play';
      gg.hands[1].forEach((id, i) => {
        const x = 12 + i * (oa * 1.2), y = 8;
        if (reveal) tile(c, x, y, oa, oa * 2, TILES[id][0], TILES[id][1], { alpha: 0.9 }); else tile(c, x, y, oa, oa * 2, 0, 0, { back: true });
      });
      /* boneyard */
      const pile = { x: W - 12 - oa * 3.2, y: 8, w: oa * 3.2, h: oa * 2 };
      c.save();
      const needDraw = myTurn() && mustDraw();
      for (let k = 0; k < Math.min(3, gg.yard.length); k++) tile(c, pile.x + k * 3, pile.y - k * 2 + 3, oa * 1.1, oa * 2, 0, 0, { back: true, ...(needDraw ? { glow: `hsl(${hue} 100% 65%)` } : {}) });
      c.fillStyle = 'rgba(220,228,255,.85)'; c.font = `600 ${Math.max(11, oa * 0.6)}px system-ui, sans-serif`; c.textAlign = 'left';
      c.fillText(`Boneyard ${gg.yard.length}`, pile.x + oa * 1.5, pile.y + oa * 1.2);
      c.restore();
      S.geo.pile = pile;

      /* the line */
      const handTop = H - Math.max(84, Math.min(190, H * 0.34));
      const chainTop = topH + 46, L = chainLayout(W, chainTop, handTop - 10);
      S.geo.chain = L;
      gg.chain.forEach((t, i) => {
        const row = Math.floor(i / L.perRow), k = i % L.perRow, rev = row % 2 === 1;
        const x = L.x0 + (rev ? L.perRow - 1 - k : k) * L.step, y = L.y0 + row * (L.a + L.gap);
        const [lv, rv] = rev ? [t.r, t.l] : [t.l, t.r];
        const last = t.id === S.lastPlay;
        tile(c, x, y, 2 * L.a, L.a, lv, rv, { glow: last ? `hsl(${hue} 100% 70%)` : null });
      });
      if (!gg.chain.length) {
        c.fillStyle = 'rgba(210,220,250,.55)'; c.font = '600 14px system-ui, sans-serif'; c.textAlign = 'center';
        c.fillText(gg.phase === 'play' ? 'The line starts here' : '', W / 2, chainTop + 30);
      } else {
        c.fillStyle = 'rgba(210,220,250,.7)'; c.font = '600 13px system-ui, sans-serif'; c.textAlign = 'center';
        c.fillText(`Ends: ${gg.ends[0]} and ${gg.ends[1]}`, W / 2, topH + 24);
      }
      /* the end pills while a two-sided tile is picked */
      S.geo.zones = null;
      if (S.sel >= 0 && myTurn()) {
        const pw = 96, ph2 = 30, py = topH + 6, sides = sidesOf(S.sel);
        S.geo.zones = {};
        [['L', W / 2 - pw - 8, `Left (${gg.ends[0]})`], ['R', W / 2 + 8, `Right (${gg.ends[1]})`]].forEach(([sd, x, label]) => {
          if (!sides.includes(sd)) return;
          const on = S.side === sd;
          c.fillStyle = on ? `hsl(${hue} 80% 52%)` : 'rgba(255,255,255,.12)';
          rr(c, x, py, pw, ph2, 10); c.fill();
          c.strokeStyle = on ? '#fff' : 'rgba(255,255,255,.35)'; c.lineWidth = 1.5; rr(c, x, py, pw, ph2, 10); c.stroke();
          c.fillStyle = '#fff'; c.font = '700 13px system-ui, sans-serif'; c.textAlign = 'center';
          c.fillText(label, x + pw / 2, py + 20);
          S.geo.zones[sd] = { x, y: py, w: pw, h: ph2 };
        });
      }

      /* my hand */
      const n = gg.hands[0].length, rows = n > 12 ? 2 : 1, per = Math.ceil(n / rows);
      const ha = Math.max(16, Math.min(46, (handTop > 0 ? (H - handTop) / (rows * 2.3) : 30), (W - 28) / (Math.max(7, per) * 1.2)));
      S.geo.hand = [];
      const legal = myTurn() ? new Set(legalNow().filter(m => m.k === 'play').map(m => m.id)) : new Set();
      gg.hands[0].forEach((id, i) => {
        const row = Math.floor(i / per), k = i % per, cnt = Math.min(per, n - row * per);
        const x = (W - cnt * ha * 1.2 + ha * 0.2) / 2 + k * ha * 1.2, y = handTop + 10 + row * (ha * 2.2);
        const can = legal.has(id), sel = S.sel === id, cur = S.cursor === i && myTurn();
        const lift = sel ? -ha * 0.3 : 0;
        const dimmed = myTurn() && !can && legal.size > 0;
        tile(c, x, y + lift, ha, ha * 2, TILES[id][0], TILES[id][1], {
          dim: dimmed, alpha: dimmed ? 0.7 : 1, edge: sel ? `hsl(${hue} 100% 62%)` : cur ? 'rgba(255,255,255,.85)' : null,
          glow: can && !dimmed && myTurn() && !S.kbOnly ? `hsl(${hue} 90% 60% / .55)` : null,
        });
        S.geo.hand.push({ id, x, y: y + lift, w: ha, h: ha * 2 });
      });
      if (S.shake && now - S.shake < 220) { c.strokeStyle = `rgba(255,90,110,${1 - (now - S.shake) / 220})`; c.lineWidth = 3; c.strokeRect(6, handTop, W - 12, H - handTop - 6); }
      if (gg.phase === 'round') {
        c.fillStyle = 'rgba(210,225,255,.9)'; c.font = '700 15px system-ui, sans-serif'; c.textAlign = 'center';
        c.fillText('Round over — press Next round (N)', W / 2, handTop - 14);
      }
    }

    /* ------------------------------ input ------------------------------ */
    const inBox = (b, x, y) => !!b && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
    function pickTile(id) {
      const sides = sidesOf(id);
      S.cursor = Math.max(0, g().hands[0].indexOf(id));
      if (!sides.length) return flash(legalNow().some(m => m.k === 'draw') ? 'That tile does not fit: draw from the boneyard.' : 'That tile does not fit either end.');
      if (sides.length === 1) return play(id, sides[0]);
      S.sel = S.sel === id ? -1 : id;
      S.side = 'L';
      paint();
      return true;
    }
    const onDown = e => {
      if (e.button > 0 || dead) return;
      snd.wake();
      const r = sf.cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      if (S.geo.zones) {
        for (const sd of ['L', 'R']) if (inBox(S.geo.zones[sd], x, y)) { play(S.sel, sd); return; }
      }
      for (const b of S.geo.hand || []) if (inBox(b, x, y)) { if (myTurn()) pickTile(b.id); return; }
      if (inBox(S.geo.pile, x, y) && myTurn()) { draw1(); return; }
      if (S.sel >= 0) { S.sel = -1; paint(); }
    };
    const onMove = e => {
      const r = sf.cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      const over = (S.geo.hand || []).some(b => inBox(b, x, y)) || inBox(S.geo.pile, x, y) || (S.geo.zones && (inBox(S.geo.zones.L, x, y) || inBox(S.geo.zones.R, x, y)));
      sf.cv.style.cursor = over && myTurn() ? 'pointer' : 'default';
    };
    const onKey = e => {
      if (!ownsKey(el, e) || dead || S.ended) return;
      const k = e.key, gg = g();
      if ((k === 'n' || k === 'N') && gg.phase === 'round') { e.preventDefault(); nextRound(); return; }
      if (k === 'Enter' && gg.phase === 'round') { e.preventDefault(); nextRound(); return; }
      if (k === 'd' || k === 'D') { e.preventDefault(); snd.wake(); draw1(); return; }
      if (k === 'p' || k === 'P') { e.preventDefault(); snd.wake(); pass(); return; }
      if ((k === 'u' || k === 'U' || k === 'z' || k === 'Z' || k === 'Backspace')) { e.preventDefault(); undo(); return; }
      if (!myTurn()) return;
      if (k === 'ArrowLeft' || k === 'ArrowRight') {
        e.preventDefault();
        snd.wake();
        if (S.sel >= 0) { const sides = sidesOf(S.sel); if (sides.length > 1) S.side = k === 'ArrowLeft' ? 'L' : 'R'; paint(); return; }
        const n = gg.hands[0].length;
        S.cursor = Math.max(0, Math.min(n - 1, S.cursor + (k === 'ArrowLeft' ? -1 : 1)));
        S.kbOnly = true;
        paint();
        return;
      }
      if (k === 'ArrowUp' && S.sel >= 0) { e.preventDefault(); S.sel = -1; paint(); return; }
      if (k === 'Enter' || k === ' ') {
        e.preventDefault();
        snd.wake();
        if (S.sel >= 0) { play(S.sel, S.side); return; }
        const id = gg.hands[0][S.cursor];
        if (id === undefined) return;
        if (mustDraw()) { draw1(); return; }
        if (mustPass()) { pass(); return; }
        pickTile(id);
      }
    };
    window.addEventListener('keydown', onKey);
    sf.cv.addEventListener('pointerdown', onDown);
    sf.cv.addEventListener('pointermove', onMove);

    newMatch();

    return {
      stop() {
        dead = true;
        S.runId++;
        clearTimeout(S.endT);
        brain.close();
        loop.stop();
        window.removeEventListener('keydown', onKey);
        sf.cv.removeEventListener('pointerdown', onDown);
        sf.cv.removeEventListener('pointermove', onMove);
        resignBtn.reset();
        snd.close();
        sf.destroy();
        root.remove();
      },
      /* test hook (inert unless a test calls it): 'seed' restarts the match on a repeatable deal */
      hook(cmd, arg) {
        if (cmd === 'seed') { rnd = seeded(arg); newMatch(); return true; }
        return false;
      },
      peek: () => {
        const gg = g();
        const legal = myTurn() ? R.moves(gg) : [];
        return {
          phase: gg.phase, turn: gg.turn, round: gg.round, target: gg.target, scores: gg.scores.slice(), level: S.level,
          hand: gg.hands[0].map(id => ({ id, t: TILES[id].slice() })), oppCount: gg.hands[1].length, yard: gg.yard.length,
          chain: gg.chain.map(t => [t.l, t.r]), ends: gg.ends && gg.ends.slice(), legal: legal.map(m => ({ ...m })), sel: S.sel,
          opened: gg.opened, result: gg.result && { ...gg.result }, thinking: S.thinking, worker: !!brain.worker, matchOver: S.matchOver, ended: S.ended,
          geo: { hand: (S.geo.hand || []).map(b => ({ ...b })), pile: S.geo.pile && { ...S.geo.pile }, zones: S.geo.zones && JSON.parse(JSON.stringify(S.geo.zones)) },
          status: statusEl.textContent, undo: S.undo.length, oppHand: gg.phase === 'play' ? null : gg.hands[1].slice(),
        };
      },
    };
  },
};
