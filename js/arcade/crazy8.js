/* ============================================================
   arcade/crazy8.js — Crazy Eights for Static Arcade.

   The common "draw until you can" rules, written out in the side
   panel and in ./eights-rules.js: match the top card's suit or rank,
   an eight is wild and names the suit, with nothing playable you draw
   one card at a time until you can play, and the first to empty their
   hand scores the points left in the others' (eight 50, K Q J 10 each,
   ace 1, others their number). 2 players get 7 cards, 3–4 get 5.

   · 1P: you against 1, 2 or 3 computer players (the choice is kept in
     portal.arcadeCrazy8). The computer only plays legal moves, keeps
     its eights back, dumps heavy cards first and names the suit it
     holds most of — about 62 % against one random player in the
     rules module's own test. It decides in microseconds, so there is
     no worker.
   · 2P: 2, 3 or 4 people share this screen. Hands stay hidden: between
     turns a cover says whose turn it is next, and your cards show only
     after you press the button. (There is no online mode: the Arcade's
     room joins two people and a card game needs hidden hands, so a
     shared seed would let each side read the other's cards.)

   Mouse or touch: click a lit card to play it, the pile to draw. An
   eight asks for a suit. Keyboard: ← → pick a card, Enter / Space play
   it, D draws, P passes (only when nothing can be drawn), 1–4 name the
   suit (♣ ♦ ♥ ♠). Score in 1P: the points you win a hand by.
   ============================================================ */
import { h } from '../core/dom.js';
import { store } from '../core/store.js';
import * as E from './eights-rules.js';
import { cardBook, drawSuit, SUIT_GLYPHS, suitColor } from './cardtable.js';
import { KIT_CSS, surface, ownsKey, sounder, looper, rr, segment, button } from './boardkit.js';

const PREF = 'portal.arcadeCrazy8';
const FONT = 'Inter,ui-sans-serif,system-ui,sans-serif';
const SUIT_WORDS = ['clubs', 'diamonds', 'hearts', 'spades'];

const readPrefs = () => {
  let p = null;
  try { p = store.get(PREF, null); } catch (err) { p = null; }
  return { cpus: [1, 2, 3].includes(p?.cpus) ? p.cpus : 1, humans: [2, 3, 4].includes(p?.humans) ? p.humans : 2 };
};
const writePrefs = patch => { try { store.set(PREF, { ...readPrefs(), ...patch }); } catch (err) { /* a convenience */ } };
const cardName = c => `${E.RANKS[c.r - 1]} of ${SUIT_WORDS[c.s]}`;
const CSS = `
.c8-log{flex:0 1 120px;min-height:44px;overflow:auto;padding:6px 8px;border-radius:var(--r-md,11px);background:var(--fill-0);border:1px solid var(--line-0);
  font:500 var(--fs-12,12px)/1.55 var(--font,system-ui);color:var(--ink-2)}
.c8-log div:last-child{color:var(--ink-0);font-weight:650}
.c8-cover,.c8-pick{position:absolute;inset:0;z-index:3;display:grid;place-items:center;background:rgba(6,5,10,.82);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);text-align:center;padding:16px}
.c8-pick{background:rgba(6,5,10,.55)}
.c8-cover[hidden],.c8-pick[hidden]{display:none}
.c8-cover h3,.c8-pick h3{margin:0 0 6px;font:800 var(--fs-18,18px)/1.2 var(--font,system-ui);color:var(--ink-0)}
.c8-cover p{margin:0 0 14px;color:var(--ink-2);font-size:var(--fs-13,13px)}
.c8-suits{display:flex;gap:10px;justify-content:center;margin-top:10px}
.c8-suits button{width:64px;height:64px;font-size:34px;line-height:1;border-radius:14px;border:1px solid var(--line-1);background:#fbfaf6;cursor:pointer}
.c8-suits button:focus-visible,.c8-cover button:focus-visible{outline:3px solid hsl(var(--h,190) 100% 72%);outline-offset:2px}
.c8-cover .arx-bg__btn{flex:0 0 auto;height:42px;padding:0 18px;font-size:var(--fs-13,13px)}
`;

export default {
  mount(el, ctx) {
    const mode = ctx.players === 2 ? 'hot' : 'cpu';
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    const prefs = readPrefs();
    let dead = false;

    const S = {
      st: null, n: mode === 'cpu' ? prefs.cpus + 1 : prefs.humans, cursor: 0, kb: false, hover: -1, log: [], plays: [],
      choose: -1, cover: false, shown: -1, ended: false, timer: 0, pulse: 0, rejected: 0, deals: 0, geo: null, cpuBusy: false, endT: 0,
    };
    const human = p => mode === 'hot' || p === 0;
    const nameOf = p => (mode === 'cpu' ? (p === 0 ? 'You' : S.n === 2 ? 'The computer' : `Computer ${p}`) : `Player ${p + 1}`);

    /* ------------------------------ the page ------------------------------ */
    const boardEl = h('div.arx-bg__board');
    const sr = h('div.arx-bg__sr', { 'aria-live': 'polite' });
    const statusEl = h('div.arx-bg__status', { role: 'status' });
    const countSeg = mode === 'cpu'
      ? segment('Computers', [1, 2, 3].map(id => ({ id, label: String(id) })), prefs.cpus, v => setCount(v + 1, { cpus: v }))
      : segment('Players', [2, 3, 4].map(id => ({ id, label: String(id) })), prefs.humans, v => setCount(v, { humans: v }));
    const drawBtn = button('Draw a card', 'plus', () => { humanDraw(); refocus(); }, { title: 'Draw (D) — only when you have nothing to play' });
    const passBtn = button('Pass', 'skip-forward', () => { humanPass(); refocus(); }, { title: 'Pass (P) — only when there is nothing left to draw' });
    const dealBtn = button('New deal', 'refresh', () => { newDeal(); refocus(); }, { title: 'Shuffle and deal again' });
    const logEl = h('div.c8-log', { 'aria-hidden': 'true' });
    const note = h('div.arx-bg__note', {
      text: 'Crazy Eights, draw-until-you-can. Match the top card’s suit or rank; an eight is wild and names the suit. '
        + 'Nothing to play? Draw one card at a time until you can. First out scores the points left in the other hands '
        + '(eight 50, K Q J 10 each, ace 1, others their number). 7 cards each for 2 players, 5 for 3 or 4.',
    });
    const side = h('div.arx-bg__side', statusEl, countSeg.el, h('div.arx-bg__row', drawBtn, passBtn), h('div.arx-bg__row', dealBtn), logEl, note);
    const pickEl = h('div.c8-pick', { hidden: true, role: 'dialog', 'aria-label': 'Choose a suit' },
      h('div', h('h3', { text: 'Eight! Name the suit' }), h('div.c8-suits', [0, 1, 2, 3].map(s => h('button', {
        type: 'button', 'aria-label': `${SUIT_WORDS[s]} (${s + 1})`, dataset: { suit: String(s) }, style: { color: suitColor(s) }, text: SUIT_GLYPHS[s],
        onclick: () => pickSuit(s),
      })))));
    const coverEl = h('div.c8-cover', { hidden: true, role: 'dialog', 'aria-label': 'Pass the screen' });
    const coverBtn = h('button.arx-bg__btn', { type: 'button', onclick: () => uncover() });
    const coverTitle = h('h3'), coverText = h('p', { text: 'Only the next player looks at the screen. Their hand stays hidden until they press the button.' });
    coverEl.append(h('div', coverTitle, coverText, coverBtn));
    boardEl.append(pickEl, coverEl);
    const root = h('div.arx-bgc', h('style', { text: KIT_CSS + CSS }), h('div.arx-bg', boardEl, side), sr);
    el.appendChild(root);
    const sf = surface(boardEl, 'Crazy Eights table', () => { book.clear(); draw(); });
    const book = cardBook(() => sf.dpr);
    const loop = looper(() => draw());
    const refocus = () => el.closest('[tabindex]')?.focus({ preventScroll: true });

    /* ------------------------------ the game ------------------------------ */
    const st = () => S.st;
    const myTurn = () => !!S.st && !S.st.over && human(S.st.turn) && !S.cover && !S.cpuBusy;
    /* whose hand is face up on this screen */
    const viewer = () => (mode === 'cpu' ? 0 : S.st.turn);
    const handVisible = () => mode === 'cpu' || (!S.cover && !S.st.over) || S.st.over;

    function newDeal() {
      clearTimeout(S.timer); clearTimeout(S.endT);
      const seed = E.cryptoSeed();
      /* the deal alternates who starts */
      S.st = E.newGame(S.n, E.rng32(seed), S.deals % S.n);
      S.deals++;
      Object.assign(S, { cursor: 0, log: [], plays: [], choose: -1, ended: false, cpuBusy: false, cover: false, shown: -1 });
      pickEl.hidden = true;
      ctx.onScore(0);
      say(`New deal. ${nameOf(S.st.turn)} ${S.st.turn === 0 && mode === 'cpu' ? 'go first' : 'goes first'}. The top card is the ${cardName(E.top(S.st))}.`);
      addLog(`New deal: ${S.n} players, ${E.handSize(S.n)} cards each. The ${cardName(E.top(S.st))} is turned up.`);
      next();
    }

    function setCount(n, patch) { S.n = n; writePrefs(patch); countSeg.set(mode === 'cpu' ? n - 1 : n); S.deals = 0; newDeal(); refocus(); }

    /* decide what happens now: a cover, a computer move, or waiting for a click */
    function next() {
      if (dead) return;
      const s = S.st;
      if (s.over) { paint(); finishSoon(); return; }
      if (mode === 'hot' && S.shown !== s.turn) {
        S.cover = true;
        coverTitle.textContent = `Pass the screen to ${nameOf(s.turn)}`;
        coverBtn.textContent = `I’m ${nameOf(s.turn)}: show my hand`;
        coverEl.hidden = false;
        paint();
        coverBtn.focus({ preventScroll: true });
        return;
      }
      if (!human(s.turn)) { S.cpuBusy = true; paint(); S.timer = setTimeout(cpuStep, reduced ? 250 : 750); return; }
      S.cursor = Math.min(S.cursor, Math.max(0, s.hands[s.turn].length - 1));
      const pl = E.legalPlays(s);
      if (pl.length && !pl.includes(S.cursor)) S.cursor = pl[0];
      paint();
    }
    function uncover() {
      if (!S.cover) return;
      S.cover = false; S.shown = S.st.turn; coverEl.hidden = true;
      snd.wake();
      next();
      refocus();
    }

    function cpuStep() {
      if (dead || !S.st || S.st.over) return;
      S.cpuBusy = false;
      const s = S.st;
      if (human(s.turn)) { next(); return; }
      const m = E.choose(s, 'smart');
      const who = s.turn;
      if (m.type === 'play') doPlay(m.idx, m.suit, who);
      else if (m.type === 'draw') { doDraw(who); S.cpuBusy = !S.st.over; if (S.cpuBusy) { paint(); S.timer = setTimeout(cpuStep, reduced ? 200 : 450); } }
      else doPass(who);
    }

    function doPlay(idx, suit, who) {
      const s = S.st;
      const c = E.play(s, idx, suit);
      if (!c) { S.rejected++; return false; }
      S.plays.push({ p: who, r: c.r, s: c.s, suit: c.r === 8 ? suit : c.s });
      S.pulse = performance.now();
      loop.kick(0.6);
      snd.blip(c.r === 8 ? 520 : 330 + c.r * 12, 0.07, c.r === 8 ? 'square' : 'triangle', 0.7, c.r === 8 ? 880 : 0);
      const t = `${nameOf(who)} played the ${cardName(c)}${c.r === 8 ? ` and named ${SUIT_WORDS[suit]}` : ''}.`;
      addLog(t); say(t);
      S.cursor = 0;
      next();
      return true;
    }
    function doDraw(who) {
      const c = E.draw(S.st);
      if (!c) { S.rejected++; return null; }
      snd.blip(220, 0.05, 'sine', 0.6, 180);
      S.pulse = performance.now();
      loop.kick(0.4);
      const mine = human(who) && (mode === 'cpu' || !S.cover);
      const t = mine ? `${nameOf(who)} drew the ${cardName(c)}.` : `${nameOf(who)} drew a card.`;
      addLog(t); say(t);
      return c;
    }
    function doPass(who) {
      if (!E.pass(S.st)) { S.rejected++; return; }
      const t = `${nameOf(who)} had nothing to play or draw, and passed.`;
      addLog(t); say(t);
      next();
    }

    function humanPlay(idx) {
      if (!myTurn() || S.choose >= 0) return false;
      const s = S.st, c = s.hands[s.turn][idx];
      if (!c || !E.playable(s, c)) {
        snd.blip(140, 0.08, 'sawtooth', 0.4);
        say(c ? `The ${cardName(c)} doesn’t match the ${cardName(E.top(s))} or the suit ${SUIT_WORDS[s.suit]}.` : 'No such card.');
        S.shake = performance.now(); loop.kick(0.3);
        return false;
      }
      if (c.r === 8) { S.choose = idx; pickEl.hidden = false; pickEl.querySelector('button')?.focus({ preventScroll: true }); say('Name a suit: 1 clubs, 2 diamonds, 3 hearts, 4 spades.'); paint(); return true; }
      return doPlay(idx, undefined, s.turn);
    }
    function pickSuit(suit) {
      if (S.choose < 0) return;
      const idx = S.choose;
      S.choose = -1; pickEl.hidden = true;
      doPlay(idx, suit, S.st.turn);
      refocus();
    }
    function humanDraw() {
      if (!myTurn() || S.choose >= 0) return;
      if (!E.mustDraw(S.st)) { snd.blip(140, 0.08, 'sawtooth', 0.4); say(E.legalPlays(S.st).length ? 'You have a card to play, so you can’t draw.' : 'Nothing left to draw.'); return; }
      doDraw(S.st.turn);
      next();
    }
    function humanPass() {
      if (!myTurn() || S.choose >= 0) return;
      if (!E.mustPass(S.st)) { snd.blip(140, 0.08, 'sawtooth', 0.4); say('You can only pass when you have nothing to play and nothing to draw.'); return; }
      doPass(S.st.turn);
    }

    function finishSoon() {
      clearTimeout(S.endT);
      S.endT = setTimeout(finish, reduced ? 300 : 1300);
    }
    function finish() {
      if (S.ended || dead || !S.st?.over) return;
      S.ended = true;
      const o = S.st.over;
      const why = o.blocked ? ' The hand was blocked: nobody could move.' : '';
      if (mode === 'cpu') {
        if (o.winner === 0) ctx.onEnd({ score: o.points, won: true, detail: `You went out and scored ${o.points} points against ${S.n - 1} computer player${S.n > 2 ? 's' : ''}.${why}` });
        else ctx.onEnd({ score: null, won: false, detail: `${nameOf(o.winner)} went out first. You were left with ${o.left[0]} points.${why}` });
      } else ctx.onEnd({ score: null, detail: `${nameOf(o.winner)} wins the hand and scores ${o.points} points.${why}` });
    }

    /* ------------------------------ text ------------------------------ */
    function say(t) { sr.textContent = t; }
    function addLog(t) {
      S.log.push(t);
      if (S.log.length > 40) S.log.shift();
      logEl.replaceChildren(...S.log.slice(-8).map(x => h('div', { text: x })));
      logEl.scrollTop = logEl.scrollHeight;
    }

    function paint() {
      if (dead || !S.st) return;
      const s = S.st;
      let text;
      if (s.over) text = `${nameOf(s.over.winner)} ${s.over.winner === 0 && mode === 'cpu' ? 'went' : 'went'} out${s.over.blocked ? ' (blocked)' : ''}: ${s.over.points} points`;
      else if (S.cover) text = `Next: ${nameOf(s.turn)}`;
      else if (!human(s.turn)) text = `${nameOf(s.turn)} is thinking…`;
      else if (E.legalPlays(s).length) text = mode === 'cpu' ? 'Your turn: play a lit card' : `${nameOf(s.turn)}: play a lit card`;
      else if (E.mustDraw(s)) text = `${mode === 'cpu' ? 'No play' : nameOf(s.turn) + ': no play'}: draw a card`;
      else text = 'Nothing to play or draw: pass';
      statusEl.textContent = text;
      statusEl.classList.toggle('is-done', !!s.over);
      const mine = myTurn() && S.choose < 0;
      drawBtn.disabled = !(mine && E.mustDraw(s));
      passBtn.disabled = !(mine && E.mustPass(s));
      sf.cv.setAttribute('aria-label', `Crazy Eights table. ${text}. Top card: ${cardName(E.top(s))}; suit in force: ${SUIT_WORDS[s.suit]}. ${handVisible() ? 'Your hand: ' + s.hands[viewer()].map(cardName).join(', ') : 'Hands are hidden.'}`);
      ctx.onScore(s.over && s.over.winner === 0 && mode === 'cpu' ? s.over.points : 0);
      draw();
    }

    /* ------------------------------ drawing ------------------------------ */
    function layout() {
      const W = sf.w, H = sf.h;
      const cw = Math.round(Math.max(34, Math.min(W / 8.5, H / 4.1 / 1.4, 96))), ch = Math.round(cw * 1.4);
      return { W, H, cw, ch, ocw: Math.round(cw * 0.56), och: Math.round(cw * 0.56 * 1.4) };
    }
    const handSlots = (L, n) => {
      const step = n > 1 ? Math.min(L.cw * 0.66, (L.W - L.cw - 24) / (n - 1)) : 0;
      const total = L.cw + step * (n - 1), x0 = (L.W - total) / 2;
      const y = L.H - L.ch - Math.max(14, L.ch * 0.14);
      return Array.from({ length: n }, (_, i) => ({ x: x0 + step * i, y }));
    };

    function draw() {
      if (dead || !S.st) return;
      const g = sf.g;
      sf.begin();
      const L = S.geo = layout();
      const s = S.st, now = performance.now();
      /* felt */
      g.fillStyle = '#04120e';
      g.fillRect(0, 0, L.W, L.H);
      const felt = g.createRadialGradient(L.W / 2, L.H * 0.45, 0, L.W / 2, L.H * 0.45, Math.max(L.W, L.H) * 0.7);
      felt.addColorStop(0, 'hsla(160,60%,22%,.9)');
      felt.addColorStop(1, 'hsla(165,60%,6%,1)');
      g.fillStyle = felt;
      g.fillRect(0, 0, L.W, L.H);
      g.textBaseline = 'alphabetic';
      /* opponents along the top */
      const others = [];
      for (let k = 1; k < s.n; k++) others.push((viewer() + k) % s.n);
      const slotW = L.W / others.length;
      others.forEach((p, i) => {
        const n = s.hands[p].length, cx = slotW * (i + 0.5), y = 34;
        const shown = Math.min(n, 12), step = Math.min(L.ocw * 0.45, (slotW - L.ocw - 20) / Math.max(1, shown - 1));
        const x0 = cx - (L.ocw + step * (shown - 1)) / 2;
        for (let j = 0; j < shown; j++) g.drawImage(book.back(L.ocw, L.och, 350), x0 + step * j, y, L.ocw, L.och);
        const turn = !s.over && s.turn === p;
        g.font = `${turn ? 800 : 650} ${Math.max(12, Math.round(L.cw * 0.2))}px ${FONT}`;
        g.textAlign = 'center';
        g.fillStyle = turn ? '#ffe28a' : 'rgba(255,255,255,.78)';
        g.fillText(`${nameOf(p)} · ${n} card${n === 1 ? '' : 's'}`, cx, y - 10);
        if (turn) { g.strokeStyle = 'rgba(255,226,138,.7)'; g.lineWidth = 2; rr(g, x0 - 5, y - 4, L.ocw + step * (shown - 1) + 10, L.och + 8, 7); g.stroke(); }
      });
      /* the two piles */
      const midY = Math.round(L.H * 0.5 - L.ch / 2 + (others.length ? L.och * 0.2 : 0));
      const stockX = L.W / 2 - L.cw * 1.15, pileX = L.W / 2 + L.cw * 0.15;
      S.geoPiles = { stock: { x: stockX, y: midY, w: L.cw, h: L.ch }, pile: { x: pileX, y: midY, w: L.cw, h: L.ch } };
      if (s.stock.length) {
        for (let i = 2; i >= 0; i--) g.drawImage(book.back(L.cw, L.ch, 350), stockX - i * 2, midY - i * 2, L.cw, L.ch);
        const can = myTurn() && E.mustDraw(s);
        if (can) { g.strokeStyle = 'rgba(255,226,138,.85)'; g.lineWidth = 3; rr(g, stockX - 3, midY - 3, L.cw + 6, L.ch + 6, L.cw * 0.09); g.stroke(); }
      } else { g.strokeStyle = 'rgba(255,255,255,.25)'; g.setLineDash([5, 5]); rr(g, stockX, midY, L.cw, L.ch, L.cw * 0.075); g.stroke(); g.setLineDash([]); }
      g.fillStyle = 'rgba(255,255,255,.6)'; g.font = `600 ${Math.max(11, Math.round(L.cw * 0.16))}px ${FONT}`; g.textAlign = 'center';
      g.fillText(`${s.stock.length} left`, stockX + L.cw / 2, midY + L.ch + 16);
      const topC = E.top(s), lift = !reduced && S.pulse && now - S.pulse < 320 ? Math.sin(((now - S.pulse) / 320) * Math.PI) * 8 : 0;
      if (s.pile.length > 1) g.drawImage(book.face(s.pile[s.pile.length - 2], L.cw, L.ch), pileX - 4, midY + 2, L.cw, L.ch);
      g.drawImage(book.face(topC, L.cw, L.ch), pileX, midY - lift, L.cw, L.ch);
      /* the suit in force */
      const bx = pileX + L.cw + 26, by = midY + L.ch / 2;
      g.fillStyle = '#fbfaf6'; g.beginPath(); g.arc(bx, by, Math.max(15, L.cw * 0.3), 0, Math.PI * 2); g.fill();
      drawSuit(g, s.suit, bx, by, Math.max(16, L.cw * 0.34));
      g.fillStyle = 'rgba(255,255,255,.6)'; g.fillText('suit', bx, by + Math.max(15, L.cw * 0.3) + 15);
      /* your hand */
      let sx = 0;
      if (S.shake && now - S.shake < 240) sx = Math.sin((now - S.shake) / 20) * 4 * (1 - (now - S.shake) / 240);
      S.geoHand = [];
      const vis = handVisible();
      const hand = s.hands[viewer()], slots = handSlots(L, hand.length);
      const pl = myTurn() ? E.legalPlays(s) : [];
      hand.forEach((c, i) => {
        const p = slots[i], lit = pl.includes(i), up = lit ? L.ch * 0.14 : 0;
        const x = p.x + (lit ? 0 : sx), y = p.y - up - (S.hover === i && lit ? 6 : 0);
        S.geoHand.push({ x: p.x, y: p.y - up, w: L.cw, h: L.ch, i });
        if (!vis) { g.drawImage(book.back(L.cw, L.ch, 350), p.x, p.y, L.cw, L.ch); return; }
        g.drawImage(book.face(c, L.cw, L.ch), x, y, L.cw, L.ch);
        if (!lit && myTurn()) { g.fillStyle = 'rgba(8,12,12,.38)'; rr(g, x, y, L.cw, L.ch, L.cw * 0.075); g.fill(); }
        if (lit) { g.strokeStyle = 'rgba(255,226,138,.8)'; g.lineWidth = 2; rr(g, x - 1, y - 1, L.cw + 2, L.ch + 2, L.cw * 0.085); g.stroke(); }
        if ((S.kb || S.hover === i) && myTurn() && S.cursor === i && S.kb) { g.strokeStyle = '#fff'; g.lineWidth = 3; g.setLineDash([5, 4]); rr(g, x - 3, y - 3, L.cw + 6, L.ch + 6, L.cw * 0.09); g.stroke(); g.setLineDash([]); }
      });
      g.textAlign = 'center'; g.fillStyle = 'rgba(255,255,255,.72)'; g.font = `650 ${Math.max(12, Math.round(L.cw * 0.2))}px ${FONT}`;
      const vn = nameOf(viewer());
      if (hand.length) g.fillText(`${vn}${vn === 'You' ? 'r hand' : '’s hand'} · ${hand.length}`, L.W / 2, slots[0].y - L.ch * 0.2 - 6);
      if (s.over) {
        g.fillStyle = 'rgba(6,5,10,.5)'; g.fillRect(0, 0, L.W, L.H);
        g.fillStyle = '#ffe28a'; g.font = `800 ${Math.round(L.cw * 0.42)}px ${FONT}`;
        g.fillText(`${nameOf(s.over.winner)} ${s.over.winner === 0 && mode === 'cpu' ? 'win' : 'wins'}! +${s.over.points}`, L.W / 2, L.H / 2 - L.ch * 0.1);
      }
    }

    /* ------------------------------ input ------------------------------ */
    const at = e => { const r = sf.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const inBox = (p, b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
    const handAt = p => { for (let i = (S.geoHand || []).length - 1; i >= 0; i--) if (inBox(p, S.geoHand[i])) return i; return -1; };
    const onDown = e => {
      if (e.button > 0 || dead) return;
      snd.wake();
      S.kb = false;
      const p = at(e);
      if (S.st.over) return;
      const i = handAt(p);
      if (i >= 0) { S.cursor = i; humanPlay(i); return; }
      if (S.geoPiles && inBox(p, S.geoPiles.stock)) humanDraw();
    };
    const onMove = e => {
      const i = handAt(at(e));
      S.kb = false;
      if (i !== S.hover) { S.hover = i; sf.cv.style.cursor = i >= 0 && myTurn() && E.legalPlays(S.st).includes(i) ? 'pointer' : 'default'; draw(); }
    };
    const onLeave = () => { if (S.hover !== -1) { S.hover = -1; draw(); } };
    const onKey = e => {
      if (!ownsKey(el, e) || dead || !S.st) return;
      const k = e.key;
      if (S.choose >= 0) {
        if (/^[1-4]$/.test(k)) { e.preventDefault(); pickSuit(Number(k) - 1); }
        return;
      }
      if (S.cover) return;
      if (S.st.over) return;
      if (k === 'ArrowLeft' || k === 'ArrowRight') {
        e.preventDefault(); snd.wake(); S.kb = true;
        const n = S.st.hands[viewer()].length;
        S.cursor = Math.max(0, Math.min(n - 1, S.cursor + (k === 'ArrowLeft' ? -1 : 1)));
        draw();
        return;
      }
      if (k === 'Enter' || k === ' ' || k === 'ArrowUp') { e.preventDefault(); snd.wake(); S.kb = true; humanPlay(S.cursor); return; }
      if (k === 'd' || k === 'D') { e.preventDefault(); snd.wake(); humanDraw(); return; }
      if (k === 'p' || k === 'P') { e.preventDefault(); humanPass(); }
    };
    window.addEventListener('keydown', onKey);
    sf.cv.addEventListener('pointerdown', onDown);
    sf.cv.addEventListener('pointermove', onMove);
    sf.cv.addEventListener('pointerleave', onLeave);

    newDeal();

    return {
      stop() {
        dead = true;
        clearTimeout(S.timer); clearTimeout(S.endT);
        loop.stop();
        window.removeEventListener('keydown', onKey);
        sf.cv.removeEventListener('pointerdown', onDown);
        sf.cv.removeEventListener('pointermove', onMove);
        sf.cv.removeEventListener('pointerleave', onLeave);
        snd.close();
        sf.destroy();
        root.remove();
      },
      peek: () => {
        const s = S.st, v = viewer();
        const centre = b => ({ x: Math.round(b.x + b.w / 2), y: Math.round(b.y + b.h / 2) });
        return {
          mode, n: s.n, turn: s.turn, viewer: v, deals: S.deals,
          hand: handVisible() ? s.hands[v].map(c => `${E.RANKS[c.r - 1]}${'CDHS'[c.s]}`) : null,
          counts: s.hands.map(x => x.length), top: `${E.RANKS[E.top(s).r - 1]}${'CDHS'[E.top(s).s]}`, suit: s.suit, stock: s.stock.length, pile: s.pile.length,
          legal: myTurn() ? E.legalPlays(s) : [], mustDraw: E.mustDraw(s), mustPass: E.mustPass(s), myTurn: myTurn(), cpuBusy: S.cpuBusy,
          covered: S.cover, choosing: S.choose >= 0, over: s.over ? { ...s.over } : null, plays: S.plays.slice(), rejected: S.rejected, ended: S.ended,
          cards: (S.geoHand || []).map(centre), stockAt: S.geoPiles ? centre(S.geoPiles.stock) : null, status: statusEl.textContent, reduced,
        };
      },
    };
  },
};
