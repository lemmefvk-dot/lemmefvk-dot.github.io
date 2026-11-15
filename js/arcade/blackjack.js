/* ============================================================
   arcade/blackjack.js — Blackjack for Static Arcade, for points only.

   You start with 500 points, put 10, 20, 50 or 100 of them in play,
   and try to get closer to 21 than the dealer without going over.
   Points are a score kept for fun: they are not money, they can't be
   bought, and nothing here is about real money. When you run out
   (under 10 points) the round ends; Finish saves whatever you have.

   Rules (full text in ./blackjack-rules.js and in the panel): a shoe
   of 1, 2, 4, 6 or 8 decks (six to start), shuffled before a hand once
   three quarters of it are dealt; the dealer draws to 16 and stands on
   every 17, soft 17 included; blackjack scores 3 for every 2 points in
   play; double on any first two cards (also after a split); split
   pairs of the same value up to four hands, aces once with one card
   each; the dealer peeks for blackjack; no insurance, no surrender.

   RECORD: every hand you finish counts as won (a blackjack too), lost
   (a bust too) or pushed — split hands count one each — kept on this
   device for each shoe size, and added up over all of them.
   STRATEGY TIPS (a switch, on to start): after each hand, every move
   you made is checked against basic strategy for these rules and this
   shoe (the charts in ./blackjack-rules.js), with only the moves the
   table allowed at that moment: "Basic strategy: double 11 against a 6
   — you hit."
   TABLE (./cardlook.js, shared by the five card games): card backs on
   the shoe and the dealer's hole card, the felt, larger cards, and
   left-handed (the panel and the shoe on the left).

   Mouse or touch: the buttons, or the cards' own table. Keyboard: Enter
   / Space deals, H hits, S stands, D doubles, P splits, 1–4 choose the
   points in play, F finishes. Score: your points when the round ends.
   Prefs (the last points in play, the shoe size, tips on or off, the
   record) live in portal.arcadeBlackjack.
   ============================================================ */
import { h } from '../core/dom.js';
import { store } from '../core/store.js';
import { icon } from '../core/icons.js';
import * as B from './blackjack-rules.js';
import { cardBook } from './cardtable.js';
import { drawBack } from './cards.js';
import { readLook, backHue, feltColors, lookCard } from './cardlook.js';
import { KIT_CSS, surface, ownsKey, sounder, looper, rr, segment, button, confirmButton } from './boardkit.js';

const PREF = 'portal.arcadeBlackjack';
const FONT = 'Inter,ui-sans-serif,system-ui,sans-serif';
const BACK_HUE = 140;              /* the backs' own colour, as before the Table look */

const count = v => (Number.isInteger(v) && v >= 0 ? v : 0);
const readPrefs = () => {
  let p = null;
  try { p = store.get(PREF, null); } catch (err) { p = null; }
  /* record: { [decks]: { w, l, p } } — hands won, lost and pushed with that shoe */
  const record = {};
  for (const d of B.DECKS) { const r = p?.record?.[d]; if (r && typeof r === 'object') record[d] = { w: count(r.w), l: count(r.l), p: count(r.p) }; }
  return { stake: B.STAKES.includes(p?.stake) ? p.stake : 20, decks: B.deckCount(p?.decks), tips: p?.tips !== false, record };
};
const writePrefs = patch => { try { store.set(PREF, { ...readPrefs(), ...patch }); } catch (err) { /* a convenience */ } };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
/* the panel never scrolls: when it is short of room the log and the rule text give way, not the points or the buttons */
const CSS = `.bj-note{font-weight:650;color:var(--ink-1)}
.bj .arx-bg__side{overflow:hidden}
.bj .bj-log{flex:0 1 auto;min-height:0;overflow:hidden}
.bj .bj-rules{flex:0 1 auto;min-height:0;overflow:auto}
.arx-bg.is-left{flex-direction:row-reverse}
@container (max-aspect-ratio: 11/10){.arx-bg.is-left{flex-direction:column}}
.bj-tip{color:var(--ink-1)}
.bj-tip[hidden]{display:none}
.bj .arx-bg__chk{flex:1;padding:2px}`;
const OUT_TEXT = { win: 'Win', lose: 'Lose', push: 'Push', bust: 'Bust', blackjack: 'Blackjack!' };

export default {
  mount(el, ctx) {
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    const prefs = readPrefs();
    let dead = false;
    const seed = B.cryptoSeed();
    const S = { t: B.newTable(B.rng32(seed), B.START_POINTS, { manual: true, decks: prefs.decks }), stake: prefs.stake, log: [], timer: 0, ended: false, busy: false, born: new WeakMap(), geo: null, rejected: 0, endT: 0, shown: [], peakPoints: B.START_POINTS,
      tips: prefs.tips, record: prefs.record, moves: [], tip: '', look: readLook() };
    S.t.points = B.START_POINTS;

    /* ------------------------------ the page ------------------------------ */
    const boardEl = h('div.arx-bg__board');
    const sr = h('div.arx-bg__sr', { 'aria-live': 'polite' });
    const statusEl = h('div.arx-bg__status', { role: 'status' });
    const pointsEl = h('div.arx-bg__status', { 'aria-label': 'Your points' });
    const stakeSeg = segment('In play', B.STAKES.map(id => ({ id, label: String(id) })), S.stake, v => { setStake(v); refocus(); });
    const dealBtn = button('Deal', 'play', () => { deal(); refocus(); }, { title: 'Deal a hand (Enter)' });
    const hitBtn = button('Hit', 'plus', () => { act('hit'); refocus(); }, { title: 'Take a card (H)' });
    const standBtn = button('Stand', 'check', () => { act('stand'); refocus(); }, { title: 'Stop here (S)' });
    const dblBtn = button('Double', 'chevron-up', () => { act('double'); refocus(); }, { title: 'Double the points in play, take one card (D)' });
    const splitBtn = button('Split', 'copy', () => { act('split'); refocus(); }, { title: 'Split a pair into two hands (P)' });
    const finishBtn = confirmButton('Finish', 'Finish? Click again', 'check', () => { finish('finished'); refocus(); });
    const tipEl = h('p.arx-bg__rules.bj-tip', { hidden: true, dataset: { k: 'tip' }, 'aria-live': 'polite' });
    const decksSeg = segment('Decks', B.DECKS.map(id => ({ id, label: String(id), title: `A shoe of ${plural(id, 'deck')} (${52 * id} cards)` })), S.t.decks, v => { setDecks(v); refocus(); });
    const shoeLine = h('div.arx-bg__rec', { dataset: { k: 'shoe' } });
    const recLine = h('div.arx-bg__rec', { dataset: { k: 'record' } });
    const tipsChk = h('label.arx-bg__chk', { title: 'After each hand, check your moves against basic strategy for these rules and this shoe' },
      h('input', { type: 'checkbox', dataset: { opt: 'tips' }, checked: S.tips, onchange: e => setTips(e.target.checked) }), h('span', { text: 'Strategy tips' }));
    const tableBtn = button('Table', 'palette', () => openLook(), { title: 'Card backs, the table, larger cards, left-handed', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' });
    const logEl = h('div.arx-bg__note.bj-log', { 'aria-hidden': 'true' });
    const notice = h('div.arx-bg__note.bj-note', { text: 'Points are just for fun. They aren’t money and can’t be bought, won or exchanged.' });
    const note = h('div.arx-bg__note.bj-rules');
    const side = h('div.arx-bg__side', pointsEl, statusEl, stakeSeg.el, h('div.arx-bg__row', dealBtn, hitBtn, standBtn), h('div.arx-bg__row', dblBtn, splitBtn, finishBtn),
      tipEl, decksSeg.el, shoeLine, recLine, h('div.arx-bg__row', tipsChk, tableBtn), notice, logEl, note);
    const tableEl = h('div.arx-bg', boardEl, side);
    const root = h('div.arx-bgc.bj', h('style', { text: KIT_CSS + CSS }), tableEl, sr);
    el.appendChild(root);
    tableEl.classList.toggle('is-left', S.look.left);
    const sf = surface(boardEl, 'Blackjack table', () => { book.clear(); draw(); });
    const book = cardBook(() => sf.dpr);
    const loop = looper(() => draw());
    const refocus = () => el.closest('[tabindex]')?.focus({ preventScroll: true });
    const later = (fn, ms) => { clearTimeout(S.timer); S.timer = setTimeout(fn, ms); };

    /* ------------------------------ the Table look ------------------------------ */
    let lookOv = null;
    function openLook() {
      if (lookOv) { closeLook(); return; }
      const card = lookCard({
        h, icon, gameHue: BACK_HUE,
        paintBack: (g, w, hh, pattern, hue) => drawBack(g, w, hh, hue, pattern),
        onChange: () => { S.look = readLook(); tableEl.classList.toggle('is-left', S.look.left); draw(); },
        onClose: () => closeLook(),
      });
      lookOv = h('div.arx-bg__dlg', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Table and cards',
        onpointerdown: e => { if (e.target === lookOv) closeLook(); },
        onkeydown: e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); closeLook(); } } }, card.el);
      boardEl.appendChild(lookOv);
      tableBtn.setAttribute('aria-expanded', 'true');
      setTimeout(() => { if (lookOv) card.focus(); }, 30);
    }
    function closeLook() {
      if (!lookOv) return;
      lookOv.remove(); lookOv = null;
      tableBtn.setAttribute('aria-expanded', 'false');
      refocus();
    }

    /* ------------------------------ the game ------------------------------ */
    const t = () => S.t;
    function setStake(v) { S.stake = v; writePrefs({ stake: v }); stakeSeg.set(v); paint(); }
    /* a new shoe: between hands only */
    function setDecks(v) {
      const s = t();
      if (S.busy || S.ended || !B.setDecks(s, v)) { snd.blip(140, 0.08, 'sawtooth', 0.4); say('Change the shoe between hands.'); decksSeg.set(s.decks); return; }
      writePrefs({ decks: v });
      decksSeg.set(v);
      addLog(`New shoe: ${plural(v, 'deck')} (${B.shoeSize(s)} cards), shuffled.`);
      say(`A new shoe of ${plural(v, 'deck')}.`);
      paint();
    }
    function setTips(on) {
      S.tips = !!on;
      writePrefs({ tips: S.tips });
      paint();
    }

    function deal() {
      if (dead || S.busy || S.ended) return;
      const s = t();
      if (!B.canDeal(s, S.stake)) { snd.blip(140, 0.08, 'sawtooth', 0.4); say(s.phase === 'play' ? 'Finish this hand first.' : `You only have ${s.points} points: choose fewer in play.`); return; }
      const shuffled = s.shuffled;
      B.deal(s, S.stake);
      S.shown = [];
      S.moves = [];
      S.tip = '';
      snd.wake();
      snd.blip(400, 0.05, 'triangle', 0.6, 520);
      loop.kick(0.8);
      say(`Dealt. You have ${B.textOf(s.hands[0].cards)}. The dealer shows ${B.codeOf(s.dealer[0])}.`);
      if (s.shuffled > shuffled) addLog(`The shoe was shuffled (fewer than ${B.cutAt(s)} cards were left).`);
      addLog(`New hand: ${S.stake} points in play.`);
      afterAction();
    }

    function act(kind) {
      if (dead || S.busy || S.ended) return;
      const s = t();
      const can = { hit: B.canHit, stand: B.canStand, double: B.canDouble, split: B.canSplit }[kind];
      if (!can(s)) { S.rejected++; snd.blip(140, 0.08, 'sawtooth', 0.4); say(`You can’t ${kind} now.`); return; }
      /* the move, and what basic strategy says with what the table allowed at this moment */
      const cur = B.current(s);
      S.moves.push({ hand: s.active, cards: cur.cards.slice(), up: s.dealer[0], choice: kind,
        adv: B.basicMove(cur.cards, s.dealer[0], { decks: s.decks, canDouble: B.canDouble(s), canSplit: B.canSplit(s) }) });
      snd.wake();
      const which = s.active;
      let c = null;
      if (kind === 'hit') c = B.hit(s);
      else if (kind === 'stand') B.stand(s);
      else if (kind === 'double') c = B.double(s);
      else B.split(s);
      snd.blip(kind === 'split' ? 520 : 360, 0.05, 'triangle', 0.7);
      loop.kick(0.6);
      const hand = s.hands[Math.min(which, s.hands.length - 1)];
      say(`${kind === 'hit' ? 'Hit' : kind === 'stand' ? 'Stand' : kind === 'double' ? 'Doubled' : 'Split'}${c ? ': ' + B.codeOf(c) : ''}. ${hand ? B.textOf(hand.cards) : ''}`);
      afterAction();
    }

    /* what happens after a move: a dealer turn plays out one card at a time, a settled hand is announced */
    function afterAction() {
      const s = t();
      paint();
      if (s.phase === 'dealer') { S.busy = true; later(dealerTurn, reduced ? 120 : 650); return; }
      if (s.phase === 'settled') settled();
    }
    function dealerTurn() {
      if (dead) return;
      const s = t();
      const c = B.dealerStep(s);
      if (c) { snd.blip(300, 0.05, 'triangle', 0.7); loop.kick(0.6); paint(); later(dealerTurn, reduced ? 120 : 650); return; }
      S.busy = false;
      paint();
      settled();
    }
    function settled() {
      const s = t();
      const d = B.handValue(s.dealer).total;
      const parts = s.hands.map((hd, i) => `${s.hands.length > 1 ? `Hand ${i + 1}: ` : ''}${OUT_TEXT[hd.outcome]} ${hd.delta > 0 ? '+' : ''}${hd.delta}`);
      const msg = `Dealer ${d > 21 ? 'busts' : d}${B.isBlackjack(s.dealer) ? ' (blackjack)' : ''}. ${parts.join(' · ')}. ${s.points} points.`;
      addLog(msg); say(msg);
      S.peakPoints = Math.max(S.peakPoints, s.points);
      /* the record for this shoe size: each of your hands once */
      const rec = { w: 0, l: 0, p: 0, ...(S.record[s.decks] || {}) };
      for (const hd of s.hands) rec[hd.outcome === 'win' || hd.outcome === 'blackjack' ? 'w' : hd.outcome === 'push' ? 'p' : 'l']++;
      S.record = { ...S.record, [s.decks]: rec };
      writePrefs({ record: S.record });
      S.tip = B.tipText(S.moves);
      const won = s.net > 0;
      snd.blip(won ? 660 : s.net < 0 ? 200 : 400, 0.14, won ? 'triangle' : 'sine', 0.8, won ? 990 : 0);
      loop.kick(0.6);
      if (B.broke(s)) { addLog('Out of points.'); later(() => finish('broke'), reduced ? 400 : 1600); }
      paint();
    }

    function finish(why) {
      if (S.ended || dead) return;
      S.ended = true;
      clearTimeout(S.timer);
      const pts = t().points;
      paint();
      const detail = why === 'broke' ? `You ran out of points after ${t().rounds} hand${t().rounds === 1 ? '' : 's'}. Points are just for fun.`
        : `You finished with ${pts} points after ${t().rounds} hand${t().rounds === 1 ? '' : 's'} (you started with ${B.START_POINTS}). Points are just for fun.`;
      ctx.onEnd({ score: pts, won: pts > B.START_POINTS, detail });
    }

    /* ------------------------------ text ------------------------------ */
    function say(m) { sr.textContent = m; }
    function addLog(m) {
      S.log.push(m);
      logEl.replaceChildren(...S.log.slice(-4).map(x => h('div', { text: x })));
    }
    function paint() {
      if (dead) return;
      const s = t();
      pointsEl.textContent = `${s.points} points`;
      let text;
      if (S.ended) text = 'Round over';
      else if (B.broke(s)) text = 'Out of points';
      else if (s.phase === 'idle') text = 'Choose the points in play, then Deal';
      else if (s.phase === 'play') text = s.hands.length > 1 ? `Hand ${s.active + 1} of ${s.hands.length}: ${B.textOf(s.hands[s.active].cards)}` : `Your hand: ${B.textOf(s.hands[0].cards)}`;
      else if (s.phase === 'dealer') text = `Dealer: ${B.textOf(s.dealer)}`;
      else text = s.net > 0 ? `You scored +${s.net}` : s.net < 0 ? `You lost ${-s.net}` : 'A push: your points come back';
      statusEl.textContent = text;
      statusEl.classList.toggle('is-done', s.phase === 'settled' && s.net > 0);
      const idle = (s.phase === 'idle' || s.phase === 'settled') && !S.ended && !S.busy;
      dealBtn.disabled = !(idle && !B.broke(s) && B.canDeal(s, S.stake));
      dealBtn.setLabel(s.phase === 'settled' ? 'Deal again' : 'Deal');
      const playing = s.phase === 'play' && !S.busy && !S.ended;
      hitBtn.disabled = !(playing && B.canHit(s));
      standBtn.disabled = !(playing && B.canStand(s));
      dblBtn.disabled = !(playing && B.canDouble(s));
      splitBtn.disabled = !(playing && B.canSplit(s));
      finishBtn.disabled = S.ended || s.phase === 'play' || s.phase === 'dealer';
      stakeSeg.disable(s.phase === 'play' || s.phase === 'dealer' || S.ended);
      stakeSeg.el.querySelectorAll('button').forEach(b => { if (Number(b.dataset.id) > s.points) b.disabled = true; });
      decksSeg.disable(!idle);
      decksSeg.set(s.decks);
      shoeLine.textContent = `Shoe: ${s.shoe.length} of ${B.shoeSize(s)} cards left · shuffled under ${B.cutAt(s)}`;
      shoeLine.title = `${plural(s.decks, 'deck')}: the shoe is shuffled before a hand once fewer than ${B.cutAt(s)} cards are left`;
      paintRecord(s.decks);
      tipEl.hidden = !(S.tips && S.tip);
      tipEl.textContent = S.tips ? S.tip : '';
      note.textContent = `${plural(s.decks, 'deck')}. The dealer draws to 16 and stands on every 17, soft 17 too. Blackjack scores 3 for every 2 points in play. `
        + 'Double on any first two cards, also after a split. Split pairs of the same value (up to four hands, aces once, one card each). '
        + 'The dealer checks for blackjack. No insurance, no surrender.';
      sf.cv.setAttribute('aria-label', `Blackjack table. ${text}. Dealer: ${s.dealer.length ? s.dealer.map((c, i) => (i === 1 && s.hole ? 'a face-down card' : B.codeOf(c))).join(', ') : 'no cards'}. ${s.hands.map((hd, i) => `Hand ${i + 1}: ${hd.cards.map(B.codeOf).join(', ')} (${B.textOf(hd.cards)})`).join('. ')}`);
      ctx.onScore(s.points);
      draw();
    }
    /* "Hands with 6 decks: 3 won · 2 lost · 1 pushed", and all shoes together once there are others */
    function paintRecord(d) {
      const sum = r => (r ? r.w + r.l + r.p : 0);
      const r = S.record[d], all = { w: 0, l: 0, p: 0 };
      for (const k of Object.keys(S.record)) for (const f of ['w', 'l', 'p']) all[f] += S.record[k][f];
      const line = x => [h('b', { text: `${x.w} won` }), ' · ', h('b', { text: `${x.l} lost` }), ' · ', h('b', { text: `${x.p} pushed` })];
      recLine.replaceChildren(
        h('div', ...(sum(r) ? [h('span', { text: `Hands with ${plural(d, 'deck')}: ` }), ...line(r)] : [h('span', { text: `No hands finished with ${plural(d, 'deck')} yet.` })])),
        sum(all) > sum(r) ? h('div', h('span', { text: 'All shoe sizes: ' }), ...line(all)) : null);
      recLine.dataset.n = String(sum(r));
    }

    /* ------------------------------ drawing ------------------------------ */
    /* "Larger cards" lifts the width limit and the cap, never the height one: the rows still fit */
    function layout() {
      const W = sf.w, H = sf.h, big = S.look.big;
      const cw = Math.round(Math.max(36, Math.min(W / (big ? 6.6 : 8), H / 4.2 / 1.4, big ? 118 : 92))), ch = Math.round(cw * 1.4);
      return { W, H, cw, ch, big };
    }
    const backOf = (w, hh) => book.back(w, hh, backHue(S.look, BACK_HUE), S.look.back);
    const faceOf = (c, w, hh) => book.face(c, w, hh, S.look.big);
    function place(L, cards, cx, y, entering) {
      const step = Math.min(L.cw * 0.64, Math.max(8, (L.W * 0.46 - L.cw) / Math.max(1, cards.length - 1)));
      const x0 = cx - (L.cw + step * (cards.length - 1)) / 2;
      return cards.map((c, i) => ({ c, x: x0 + step * i, y, i }));
    }

    function draw() {
      if (dead) return;
      const g = sf.g;
      sf.begin();
      const L = S.geo = layout();
      const s = t(), now = performance.now();
      /* felt: the game's own dark table, or the one chosen under Table */
      const fc = feltColors(S.look);
      g.fillStyle = fc ? fc[1] : '#04120e';
      g.fillRect(0, 0, L.W, L.H);
      const felt = g.createRadialGradient(L.W / 2, L.H * 0.5, 0, L.W / 2, L.H * 0.5, Math.max(L.W, L.H) * 0.7);
      felt.addColorStop(0, fc ? fc[0] : 'hsla(150,55%,20%,.95)');
      felt.addColorStop(1, fc ? fc[1] : 'hsla(160,60%,5%,1)');
      g.fillStyle = felt;
      g.fillRect(0, 0, L.W, L.H);
      g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      g.fillStyle = 'rgba(255,255,255,.16)';
      g.font = `800 ${Math.round(L.cw * 0.3)}px ${FONT}`;
      g.fillText('BLACKJACK · FOR POINTS ONLY', L.W / 2, L.H / 2 + L.cw * 0.1);
      g.font = `600 ${Math.round(L.cw * 0.17)}px ${FONT}`;
      g.fillText('Dealer stands on all 17s · blackjack scores 3 to 2', L.W / 2, L.H / 2 + L.cw * 0.38);
      /* the shoe: top right, or top left for a left-handed table */
      const shoe = { x: S.look.left ? L.cw * 0.4 : L.W - L.cw * 1.1, y: 14, w: L.cw * 0.7, h: L.ch * 0.7 };
      S.geoShoe = shoe;
      for (let i = 2; i >= 0; i--) g.drawImage(backOf(shoe.w, shoe.h), shoe.x - i * 2, shoe.y - i * 2, shoe.w, shoe.h);
      g.fillStyle = 'rgba(255,255,255,.55)';
      g.font = `600 ${Math.max(10, Math.round(L.cw * 0.14))}px ${FONT}`;
      g.fillText(`${s.shoe.length} left`, shoe.x + shoe.w / 2, shoe.y + shoe.h + 14);
      const drawCards = (list, faceDown, hl) => {
        for (const p of list) {
          const born = S.born.get(p.c) ?? (S.born.set(p.c, now), now);
          const k = reduced ? 1 : Math.min(1, (now - born) / 260), e = 1 - (1 - k) * (1 - k);
          const x = shoe.x + (p.x - shoe.x) * e, y = shoe.y + (p.y - shoe.y) * e;
          if (k < 1) loop.kick(0.1);
          g.globalAlpha = 0.35 + 0.65 * e;
          if (faceDown && p.i === 1) g.drawImage(backOf(L.cw, L.ch), x, y, L.cw, L.ch);
          else g.drawImage(faceOf(p.c, L.cw, L.ch), x, y, L.cw, L.ch);
          g.globalAlpha = 1;
        }
      };
      /* the dealer */
      const dy = Math.max(30, L.ch * 0.35);
      const dlist = place(L, s.dealer, L.W / 2, dy);
      drawCards(dlist, s.hole);
      g.fillStyle = 'rgba(255,255,255,.8)'; g.font = `700 ${Math.max(12, Math.round(L.cw * 0.2))}px ${FONT}`;
      g.fillText(s.dealer.length ? `Dealer · ${s.hole ? valueShown(s.dealer[0]) : B.textOf(s.dealer)}` : 'Dealer', L.W / 2, dy - 8);
      /* your hands */
      const n = Math.max(1, s.hands.length);
      const y = L.H - L.ch - Math.max(40, L.ch * 0.4);
      S.shown = [];
      s.hands.forEach((hd, i) => {
        const cx = (L.W / n) * (i + 0.5);
        const list = place(L, hd.cards, cx, y);
        const act = s.phase === 'play' && s.active === i;
        const w = (list.length ? list[list.length - 1].x + L.cw - list[0].x : L.cw) + 12;
        if (act) { g.strokeStyle = 'rgba(255,226,138,.85)'; g.lineWidth = 3; rr(g, list[0].x - 6, y - 6, w, L.ch + 12, 9); g.stroke(); }
        drawCards(list, false);
        const txt = B.textOf(hd.cards);
        g.fillStyle = act ? '#ffe28a' : 'rgba(255,255,255,.85)';
        g.font = `700 ${Math.max(12, Math.round(L.cw * 0.2))}px ${FONT}`;
        g.fillText(`${n > 1 ? `Hand ${i + 1} · ` : ''}${txt}${hd.doubled ? ' · doubled' : ''}`, cx, y + L.ch + 22);
        g.fillStyle = 'rgba(255,255,255,.6)';
        g.font = `600 ${Math.max(11, Math.round(L.cw * 0.16))}px ${FONT}`;
        g.fillText(`${hd.stake} points in play`, cx, y - 12);
        if (hd.outcome) {
          const good = hd.delta > 0, bad = hd.delta < 0;
          g.save();
          g.fillStyle = good ? '#7dffb0' : bad ? '#ff8da1' : '#ffe28a';
          g.font = `800 ${Math.round(L.cw * 0.34)}px ${FONT}`;
          g.shadowColor = 'rgba(0,0,0,.7)'; g.shadowBlur = 8;
          g.fillText(`${OUT_TEXT[hd.outcome]} ${hd.delta > 0 ? '+' : ''}${hd.delta !== 0 ? hd.delta : ''}`.trim(), cx, y + L.ch * 0.55);
          g.restore();
        }
        S.shown.push({ i, cx });
      });
    }
    const valueShown = c => String(B.valueOf(c) === 11 ? 'A' : B.valueOf(c));

    /* ------------------------------ input ------------------------------ */
    const onKey = e => {
      if (!ownsKey(el, e) || dead || lookOv) return;
      const k = e.key.toLowerCase();
      const s = t();
      if (k === 'enter' || k === ' ') { if (s.phase === 'idle' || s.phase === 'settled') { e.preventDefault(); deal(); } return; }
      if (k === 'h') { e.preventDefault(); act('hit'); return; }
      if (k === 's') { e.preventDefault(); act('stand'); return; }
      if (k === 'd') { e.preventDefault(); act('double'); return; }
      if (k === 'p') { e.preventDefault(); act('split'); return; }
      if (k === 'f' && !finishBtn.disabled) { e.preventDefault(); finishBtn.click(); return; }
      if (/^[1-4]$/.test(k) && (s.phase === 'idle' || s.phase === 'settled') && B.STAKES[Number(k) - 1] <= s.points) { e.preventDefault(); setStake(B.STAKES[Number(k) - 1]); }
    };
    window.addEventListener('keydown', onKey);
    /* a click on the table itself deals when it is time to */
    const onDown = () => { snd.wake(); if (!S.busy && (t().phase === 'idle' || t().phase === 'settled')) deal(); };
    sf.cv.addEventListener('pointerdown', onDown);
    paint();
    addLog(`You start with ${B.START_POINTS} points.`);

    return {
      stop() {
        dead = true;
        clearTimeout(S.timer); clearTimeout(S.endT);
        loop.stop();
        window.removeEventListener('keydown', onKey);
        sf.cv.removeEventListener('pointerdown', onDown);
        finishBtn.reset?.();
        snd.close();
        sf.destroy();
        root.remove();
      },
      peek: () => {
        const s = t();
        return {
          phase: s.phase, points: s.points, stake: S.stake, rounds: s.rounds, busy: S.busy, ended: S.ended, net: s.net, rejected: S.rejected,
          dealer: s.dealer.map((c, i) => (i === 1 && s.hole ? 'XX' : B.codeOf(c))), dealerTotal: s.hole ? null : B.handValue(s.dealer).total,
          hands: s.hands.map(hd => ({ cards: hd.cards.map(B.codeOf), total: B.handValue(hd.cards).total, soft: B.handValue(hd.cards).soft, stake: hd.stake, done: hd.done, outcome: hd.outcome, delta: hd.delta, doubled: hd.doubled })),
          active: s.active, can: { hit: B.canHit(s), stand: B.canStand(s), double: B.canDouble(s), split: B.canSplit(s), deal: B.canDeal(s, S.stake) },
          shoe: s.shoe.length, shuffled: s.shuffled, status: statusEl.textContent, reduced,
          buttons: { deal: !dealBtn.disabled, hit: !hitBtn.disabled, stand: !standBtn.disabled, double: !dblBtn.disabled, split: !splitBtn.disabled },
          decks: s.decks, shoeSize: B.shoeSize(s), cutAt: B.cutAt(s), shoeText: shoeLine.textContent, record: JSON.parse(JSON.stringify(S.record)), recordText: recLine.textContent,
          tips: S.tips, tip: S.tips ? S.tip : null, tipShown: !tipEl.hidden ? tipEl.textContent : null,
          moves: S.moves.map(m => ({ hand: m.hand, cards: m.cards.map(B.codeOf), up: B.codeOf(m.up), choice: m.choice, advice: m.adv.move, code: m.adv.code })),
          decksOn: !decksSeg.el.querySelector('button').disabled, lookOpen: !!lookOv,
          /* the Table look in use, and where it put things (CSS px in the canvas; the panel's side of the board) */
          look: { ...S.look }, backHue: backHue(S.look, BACK_HUE),
          geo: S.geo ? { W: S.geo.W, H: S.geo.H, cw: S.geo.cw, ch: S.geo.ch, shoe: S.geoShoe ? { x: Math.round(S.geoShoe.x), y: Math.round(S.geoShoe.y), w: Math.round(S.geoShoe.w), h: Math.round(S.geoShoe.h) } : null,
            panel: side.getBoundingClientRect().x < boardEl.getBoundingClientRect().x ? 'left' : 'right' } : null,
        };
      },
      /* test hook, inert unless a test calls it: stack the next cards to be drawn, in order
         (a shoe due for its shuffle is shuffled first, so the deal keeps the stacked cards) */
      hook: cmd => {
        if (cmd && Array.isArray(cmd.stack)) { if (B.needsShuffle(t())) B.reshuffle(t()); const cards = cmd.stack.map(B.parseCode).filter(Boolean); t().shoe.push(...cards.reverse()); }
        if (cmd && Number.isInteger(cmd.points)) { t().points = cmd.points; paint(); }
        return true;
      },
    };
  },
};
