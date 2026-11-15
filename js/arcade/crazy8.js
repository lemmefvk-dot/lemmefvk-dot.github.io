/* ============================================================
   arcade/crazy8.js — Crazy Eights for Static Arcade.

   The common "draw until you can" rules, written out in the side
   panel and in ./eights-rules.js: match the top card's suit or rank,
   an eight is wild and names the suit, with nothing playable you draw
   one card at a time until you can play, and the first to empty their
   hand scores the points left in the others' (eight 50, K Q J 10 each,
   ace 1, others their number). 2 players get 7 cards, 3–4 get 5.

   HOUSE RULES (the Rules button): twos draw two (stackable), queens
   skip, aces reverse, draw one then pass, eights follow suit, no going
   out on an eight — each a switch, all off by default; the rules module
   says exactly what each does. The panel's summary line always says the
   rules in play; a change starts a new deal. The computer plays by the
   same rules (it picks from the same legal moves).

   TABLE (the Table button, ./cardlook.js, shared by the five card games):
   card back and colour on every face-down card, the felt, larger cards
   (bigger, with the big-index faces, as far as the table's height allows),
   and left-handed (the panel and the draw pile on the left).

   · 1P: you against 1, 2 or 3 computer players (the choice and the house
     rules are kept in portal.arcadeCrazy8). The computer only plays legal moves, keeps
     its eights back, dumps heavy cards first and names the suit it
     holds most of — about 62 % against one random player in the
     rules module's own test. It decides in microseconds, so there is
     no worker.
   · 2P: 2, 3 or 4 people share this screen. Hands stay hidden: between
     turns a cover says whose turn it is next, and your cards show only
     after you press the button.
   · ONLINE (ctx.online, a friend through the Arcade's room): two
     players, the classic rules (no house rules), one hand a round. The
     HOST's game is the real one (./hostlink.js): it shuffles with the
     browser's crypto (never the room's seed, which the guest knows),
     deals, and checks every card the guest plays. The guest's screen is
     sent only its own hand, the top two cards of the pile, the suit in
     force, how many cards the host holds and how many are left to draw,
     whose turn it is and what was just played — never the host's cards,
     not even at the end (only the points left in them). A draw the host
     makes is sent as "drew a card". The host plays first in odd rounds,
     the guest in even ones, so the first turn swaps every rematch. On
     your screen you are always at the bottom.

   Mouse or touch: click a lit card to play it, the pile to draw. An
   eight asks for a suit. Keyboard: ← → pick a card, Enter / Space play
   it, D draws (or takes the cards a two owes), P passes (only when
   nothing can be drawn, or after the one draw of "draw one"), 1–4 name
   the suit (♣ ♦ ♥ ♠). Score in 1P: the points you win a hand by.
   ============================================================ */
import { h } from '../core/dom.js';
import { store } from '../core/store.js';
import { icon } from '../core/icons.js';
import * as E from './eights-rules.js';
import { cardBook, drawSuit, SUIT_GLYPHS, suitColor } from './cardtable.js';
import { drawBack } from './cards.js';
import { readLook, backHue, feltColors, lookCard } from './cardlook.js';
import { KIT_CSS, surface, ownsKey, sounder, looper, rr, segment, button } from './boardkit.js';
import { hostLink, guestLink } from './hostlink.js';

const PREF = 'portal.arcadeCrazy8';
const FONT = 'Inter,ui-sans-serif,system-ui,sans-serif';
const SUIT_WORDS = ['clubs', 'diamonds', 'hearts', 'spades'];
const BACK_HUE = 350;              /* the backs' own colour, as before the Table look */

const readPrefs = () => {
  let p = null;
  try { p = store.get(PREF, null); } catch (err) { p = null; }
  return { cpus: [1, 2, 3].includes(p?.cpus) ? p.cpus : 1, humans: [2, 3, 4].includes(p?.humans) ? p.humans : 2, rules: E.houseRules(p?.rules) };
};
const writePrefs = patch => { try { store.set(PREF, { ...readPrefs(), ...patch }); } catch (err) { /* a convenience */ } };
const cardName = c => `${E.RANKS[c.r - 1]} of ${SUIT_WORDS[c.s]}`;

/* ---------------- online: the guest's view of the host's game ----------------
   v = { h: [my cards], o: their count, k: draw pile, pl: pile size, t: top card,
         u: the card under it ('' if none), su: suit in force, tu: whose turn (0 = me),
         dn: cards drawn this turn, np: plays so far, ov: null | { w, p, b, l: [mine, theirs] },
         lg: [[id, who, 'p'|'d'|'x', card or '', suit or -1]] the last few actions }
   Every field is checked; a view that fails is dropped whole. */
const CODE_RE = /^(10|[A2-9JQK])[CDHS]$/;
const HIDDEN = Object.freeze({ r: 0, s: -1 });       /* a card the other player holds: never its face */
const NET_RULES = Object.freeze(E.houseRules(null));
const okInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const okCode = c => typeof c === 'string' && CODE_RE.test(c);
export function readView(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  if (!Array.isArray(v.h) || v.h.length > 52 || !v.h.every(okCode)) return null;
  if (!okInt(v.o, 0, 52) || !okInt(v.k, 0, 52) || !okInt(v.pl, 1, 52) || !okCode(v.t) || !(v.u === '' || okCode(v.u))) return null;
  if (!okInt(v.su, 0, 3) || !okInt(v.tu, 0, 1) || !okInt(v.dn, 0, 52) || !okInt(v.np, 0, 99999)) return null;
  if (v.h.length + v.o + v.k + v.pl > 52) return null;
  let over = null;
  if (v.ov !== null && v.ov !== undefined) {
    const o = v.ov;
    if (!o || typeof o !== 'object' || !okInt(o.w, 0, 1) || !okInt(o.p, 0, 9999) || !Array.isArray(o.l) || o.l.length !== 2 || !o.l.every(x => okInt(x, 0, 9999))) return null;
    over = { winner: o.w, points: o.p, blocked: !!o.b, left: o.l.slice() };
  }
  const log = Array.isArray(v.lg) ? v.lg.slice(-8).filter(e => Array.isArray(e) && okInt(e[0], 1, 1e7) && okInt(e[1], 0, 1) && ['p', 'd', 'x'].includes(e[2])
    && (e[3] === '' || okCode(e[3])) && okInt(e[4], -1, 3)) : [];
  const top = E.parseCode(v.t), under = v.u ? E.parseCode(v.u) : null;
  /* the pile's size matters to the rules (what can still be drawn); only its top two are known */
  const pile = Array.from({ length: v.pl }, () => top);
  if (under && v.pl > 1) pile[v.pl - 2] = under;
  return {
    st: {
      n: 2, rnd: null, hands: [v.h.map(E.parseCode), Array.from({ length: v.o }, () => HIDDEN)], stock: Array.from({ length: v.k }, () => HIDDEN), pile,
      suit: v.su, turn: v.tu, drawn: v.dn, passes: 0, idle: 0, over, plays: v.np, rules: NET_RULES, dir: 1, pending: 0, fx: null,
    },
    log,
  };
}
/* the panel's rule text, for the rules in play (the house rules' own words are in the summary line) */
const noteText = R => `Crazy Eights, ${R.drawOne ? 'draw-one' : 'draw-until-you-can'}. Match the top card’s suit or rank; an eight is wild and names the suit`
  + `${R.eightSuit ? ' (here it only goes on the suit in force, or on another eight)' : ''}. `
  + (R.drawOne ? 'Nothing to play? Draw one card, then play a card if you now can, or pass. ' : 'Nothing to play? Draw one card at a time until you can. ')
  + `${R.noEightOut ? 'You can’t go out on an eight. ' : ''}First out scores the points left in the other hands `
  + '(eight 50, K Q J 10 each, ace 1, others their number). 7 cards each for 2 players, 5 for 3 or 4.';
/* the panel never scrolls: short of room, the rule text gives way first, then the log */
const CSS = `
.c8 .arx-bg__side{overflow:hidden}
.c8 .c8-note{flex:0 1 auto;min-height:0;overflow:auto}
.arx-bg.is-left{flex-direction:row-reverse}
@container (max-aspect-ratio: 11/10){.arx-bg.is-left{flex-direction:column}}
.c8-dlg .arc-ov__card{gap:2px}
.c8-dlg .arx-bg__rules{margin-top:6px}
.c8-dlg__note{margin:4px 0 0;font-size:var(--fs-11,11px);color:var(--ink-3)}
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
    /* online: the host runs the game, the guest sees its own view of it (see the header) */
    const NET = ctx.online && typeof ctx.online.send === 'function' ? ctx.online : null;
    const mode = NET ? 'net' : ctx.players === 2 ? 'hot' : 'cpu';
    const guest = !!NET && NET.role !== 'host';
    const peerName = String(NET?.peer?.name || 'Your friend');
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    const prefs = readPrefs();
    let dead = false;
    let hl = null, gl = null;              /* the host's link / the guest's link (./hostlink.js) */

    const S = {
      st: null, n: NET ? 2 : mode === 'cpu' ? prefs.cpus + 1 : prefs.humans, cursor: 0, kb: false, hover: -1, log: [], plays: [],
      choose: -1, cover: false, shown: -1, ended: false, timer: 0, pulse: 0, rejected: 0, deals: 0, geo: null, cpuBusy: false, endT: 0,
      rules: NET ? NET_RULES : prefs.rules, look: readLook(),
      netLog: [], netId: 0, netQ: -1, netSeen: 0, badViews: 0,
    };
    const human = p => mode === 'hot' || p === 0;
    const nameOf = p => (mode === 'net' ? (p === 0 ? 'You' : peerName) : mode === 'cpu' ? (p === 0 ? 'You' : S.n === 2 ? 'The computer' : `Computer ${p}`) : `Player ${p + 1}`);
    const isAre = p => (mode !== 'hot' && p === 0 ? 'are' : 'is');

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
    const rulesBtn = button('Rules', 'sliders', () => openRules(), { title: 'House rules: twos, queens, aces, drawing, eights', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' });
    const tableBtn = button('Table', 'palette', () => openLook(), { title: 'Card backs, the table, larger cards, left-handed', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' });
    const rulesLine = h('p.arx-bg__rules', { dataset: { k: 'rules' } });
    const logEl = h('div.c8-log', { 'aria-hidden': 'true' });
    const note = h('div.arx-bg__note.c8-note');
    /* online: no player count, no new deal and no house rules — the room starts each hand, with the classic rules */
    const side = mode === 'net'
      ? h('div.arx-bg__side', statusEl, h('div.arx-bg__row', drawBtn, passBtn), h('div.arx-bg__row', tableBtn), rulesLine, logEl, note)
      : h('div.arx-bg__side', statusEl, countSeg.el, h('div.arx-bg__row', drawBtn, passBtn), h('div.arx-bg__row', dealBtn), h('div.arx-bg__row', rulesBtn, tableBtn), rulesLine, logEl, note);
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
    const tableEl = h('div.arx-bg', boardEl, side);
    const root = h('div.arx-bgc.c8', h('style', { text: KIT_CSS + CSS }), tableEl, sr);
    el.appendChild(root);
    const sf = surface(boardEl, 'Crazy Eights table', () => { book.clear(); draw(); });
    const book = cardBook(() => sf.dpr);
    const loop = looper(() => draw());
    const refocus = () => el.closest('[tabindex]')?.focus({ preventScroll: true });
    const showRules = () => { rulesLine.textContent = E.rulesSummary(S.rules, S.n); note.textContent = noteText(S.rules); };
    tableEl.classList.toggle('is-left', S.look.left);
    showRules();

    /* ------------------------------ house rules and the Table look ------------------------------ */
    /* both are cards over the table; Esc, Done or a click beside the card closes them */
    let rulesOv = null, draft = null, lookOv = null;
    const dialog = (label, card, close) => {
      const ov = h('div.arx-bg__dlg.c8-dlg', { role: 'dialog', 'aria-modal': 'true', 'aria-label': label,
        onpointerdown: e => { if (e.target === ov) close(); },
        onkeydown: e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); close(); } } }, card);
      boardEl.appendChild(ov);
      return ov;
    };
    function openRules() {
      if (rulesOv) { closeRules(); return; }
      closeLook();
      draft = { ...S.rules };
      const sum = h('p.arx-bg__rules', { text: E.rulesSummary(draft, S.n) });
      const chk = x => h('label.arx-bg__chk', h('input', { type: 'checkbox', dataset: { rule: x.id }, checked: draft[x.id], onchange: e => { draft[x.id] = e.target.checked; sum.textContent = E.rulesSummary(draft, S.n); } }),
        h('span', h('span', { text: x.label }), h('small', { text: x.note })));
      const done = h('button.arc-ov__btn.is-primary', { type: 'button', onclick: () => closeRules() }, h('span', { text: 'Done' }));
      rulesOv = dialog('House rules', h('div.arc-ov__card', h('h3', { text: 'House rules' }), E.HOUSE.map(chk), sum,
        h('p.c8-dlg__note', { text: 'The computer plays by the same rules. A change starts a new deal when you close this.' }), h('div.arc-ov__row', done)), closeRules);
      rulesBtn.setAttribute('aria-expanded', 'true');
      setTimeout(() => rulesOv?.querySelector('input')?.focus({ preventScroll: true }), 30);
    }
    function closeRules() {
      if (!rulesOv) return;
      rulesOv.remove(); rulesOv = null;
      rulesBtn.setAttribute('aria-expanded', 'false');
      const next = E.houseRules(draft);
      if (E.HOUSE.some(x => next[x.id] !== S.rules[x.id])) {
        S.rules = next;
        writePrefs({ rules: next });
        showRules();
        newDeal();
        addLog(`New rules. ${E.rulesSummary(next, S.n)}`);
      }
      refocus();
    }
    function openLook() {
      if (lookOv) { closeLook(); return; }
      closeRules();
      const card = lookCard({
        h, icon, gameHue: BACK_HUE, feltHue: 160,
        paintBack: (g, w, hh, pattern, hue) => drawBack(g, w, hh, hue, pattern),
        onChange: () => { S.look = readLook(); tableEl.classList.toggle('is-left', S.look.left); draw(); },
        onClose: () => closeLook(),
      });
      lookOv = dialog('Table and cards', card.el, closeLook);
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
    const st = () => S.st;
    /* online, the guest waits while its move is on the way to the host */
    const myTurn = () => !!S.st && !S.st.over && human(S.st.turn) && !S.cover && !S.cpuBusy && !gl?.waiting;
    /* whose hand is face up on this screen */
    const viewer = () => (mode !== 'hot' ? 0 : S.st.turn);
    const handVisible = () => mode !== 'hot' || (!S.cover && !S.st.over) || S.st.over;

    function newDeal() {
      if (guest) return;                     /* the host deals */
      clearTimeout(S.timer); clearTimeout(S.endT);
      const seed = E.cryptoSeed();
      /* the deal alternates who starts; online the host starts odd rounds and the guest even ones */
      const first = NET ? ((Number(NET.round) || 1) % 2 === 1 ? 0 : 1) : S.deals % S.n;
      S.st = E.newGame(S.n, E.rng32(seed), first, S.rules);
      S.deals++;
      Object.assign(S, { cursor: 0, log: [], plays: [], choose: -1, ended: false, cpuBusy: false, cover: false, shown: -1 });
      pickEl.hidden = true;
      ctx.onScore(0);
      say(`New deal. ${nameOf(S.st.turn)} ${S.st.turn === 0 && mode !== 'hot' ? 'go first' : 'goes first'}. The top card is the ${cardName(E.top(S.st))}.`);
      addLog(`New deal: ${S.n} players, ${E.handSize(S.n)} cards each. The ${cardName(E.top(S.st))} is turned up.`);
      S.netLog = [];
      hl?.changed();
      next();
    }

    /* ------------------------------ online ------------------------------ */
    /* the host: what the guest (seat 1) may see — never seat 0's cards */
    function viewFor() {
      const s = S.st;
      const map = p => (p === 1 ? 0 : 1);
      return {
        h: s.hands[1].map(E.codeOf), o: s.hands[0].length, k: s.stock.length, pl: s.pile.length,
        t: E.codeOf(E.top(s)), u: s.pile.length > 1 ? E.codeOf(s.pile[s.pile.length - 2]) : '',
        su: s.suit, tu: map(s.turn), dn: s.drawn, np: s.plays,
        ov: s.over ? { w: map(s.over.winner), p: s.over.points, b: s.over.blocked ? 1 : 0, l: [s.over.left[1], s.over.left[0]] } : null,
        /* a card is named for a play (it is on the table) and for the guest's own draw — never for the host's draw */
        lg: S.netLog.slice(-6).map(e => [e.id, map(e.who), e.y, e.y === 'p' || (e.y === 'd' && e.who === 1) ? e.c : '', e.y === 'p' ? e.s : -1]),
      };
    }
    function netNote(who, y, c = null, suit = -1) {
      if (mode !== 'net' || guest) return;
      S.netLog.push({ id: ++S.netId, who, y, c: c ? E.codeOf(c) : '', s: suit });
      if (S.netLog.length > 10) S.netLog.shift();
      if (who === 0) hl?.changed();          /* the guest's own moves are pushed by the link once taken */
    }
    /* the host: a move in the guest's name — checked by the rules before anything changes */
    function netAct(a) {
      const s = S.st;
      if (!s || s.over || s.turn !== 1 || !a || typeof a !== 'object' || Array.isArray(a)) { S.rejected++; return false; }
      if (a.y === 'p') {
        const c = okCode(a.c) ? E.parseCode(a.c) : null;
        const idx = c ? s.hands[1].findIndex(x => x.r === c.r && x.s === c.s) : -1;
        if (idx < 0 || !E.playable(s, s.hands[1][idx]) || (c.r === 8 && !okInt(a.s, 0, 3))) { S.rejected++; return false; }
        return doPlay(idx, c.r === 8 ? a.s : undefined, 1);
      }
      if (a.y === 'd') {
        if (!doDraw(1)) return false;
        next();
        return true;
      }
      if (a.y === 'x') {
        if (!E.canPass(s)) { S.rejected++; return false; }
        doPass(1);
        return true;
      }
      S.rejected++;
      return false;
    }
    /* the guest: a view from the host becomes this screen's table */
    function showView(v, q, refused) {
      if (dead) return;
      if (q === S.netQ && !refused) return;   /* the same view again (the host's beat) */
      const r = readView(v);
      if (!r) { S.badViews++; return; }
      S.netQ = q;
      const first = !S.st;
      const was = S.st;
      S.st = r.st;
      if (refused) { S.rejected++; say(`${peerName}’s game didn’t take that move.`); }
      if (first) addLog(`New deal: 2 players, 7 cards each. The ${cardName(E.top(S.st))} is turned up.`);
      for (const e of r.log) {
        if (e[0] <= S.netSeen) continue;
        S.netSeen = e[0];
        const who = nameOf(e[1]), c = e[3] ? E.parseCode(e[3]) : null;
        const t = e[2] === 'p' ? `${who} played the ${cardName(c)}${c.r === 8 && e[4] >= 0 ? ` and named ${SUIT_WORDS[e[4]]}` : ''}.`
          : e[2] === 'd' ? (c ? `${who} drew the ${cardName(c)}.` : `${who} drew a card.`)
            : `${who} had nothing to play or draw, and passed.`;
        addLog(t); say(t);
        if (e[2] === 'p') { S.pulse = performance.now(); loop.kick(0.6); if (e[1] === 1) snd.blip(c.r === 8 ? 520 : 330 + c.r * 12, 0.07, c.r === 8 ? 'square' : 'triangle', 0.7, c.r === 8 ? 880 : 0); }
        else if (e[2] === 'd' && e[1] === 1) snd.blip(220, 0.05, 'sine', 0.6, 180);
      }
      if (was && S.choose >= 0 && (S.st.turn !== 0 || !S.st.hands[0][S.choose])) { S.choose = -1; pickEl.hidden = true; }
      if (first && !S.st.over) say(`${nameOf(S.st.turn)} ${S.st.turn === 0 ? 'go first' : 'goes first'}. The top card is the ${cardName(E.top(S.st))}.`);
      if (S.st.turn === 0) {
        S.cursor = Math.min(S.cursor, Math.max(0, S.st.hands[0].length - 1));
        const pl = E.legalPlays(S.st);
        if (pl.length && !pl.includes(S.cursor)) S.cursor = pl[0];
      }
      paint();
      if (S.st.over) finishSoon();
    }
    /* the guest: my move goes to the host, and the table changes when its next view comes */
    function netSend(a) {
      if (!gl || gl.waiting) return false;
      gl.act(a);
      paint();
      return true;
    }

    function setCount(n, patch) { S.n = n; writePrefs(patch); countSeg.set(mode === 'cpu' ? n - 1 : n); S.deals = 0; showRules(); newDeal(); refocus(); }

    /* decide what happens now: a cover, a computer move, or waiting for a click */
    function next() {
      if (dead) return;
      const s = S.st;
      if (s.over) { paint(); finishSoon(); return; }
      /* online: the friend's move comes over the room */
      if (mode === 'net' && s.turn !== 0) { paint(); return; }
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
      else if (m.type === 'take') { doTake(who); next(); }
      else doPass(who);
    }

    function doPlay(idx, suit, who) {
      const s = S.st;
      const c = E.play(s, idx, suit);
      if (!c) { S.rejected++; return false; }
      const fx = s.fx;
      S.plays.push({ p: who, r: c.r, s: c.s, suit: c.r === 8 ? suit : c.s, next: s.over ? -1 : s.turn, skip: fx ? fx.skip : -1, reverse: !!fx?.reverse, owed: fx ? fx.owed : 0 });
      S.pulse = performance.now();
      loop.kick(0.6);
      snd.blip(c.r === 8 ? 520 : 330 + c.r * 12, 0.07, c.r === 8 ? 'square' : 'triangle', 0.7, c.r === 8 ? 880 : 0);
      /* what a house rule did, in the same line */
      const also = [];
      if (fx?.reverse) also.push('Play now goes the other way.');
      if (fx?.skip >= 0) also.push(`${nameOf(fx.skip)} ${isAre(fx.skip)} skipped.`);
      if (fx?.owed) also.push(`${nameOf(s.turn)} must take ${fx.owed} cards or play a two.`);
      const t = `${nameOf(who)} played the ${cardName(c)}${c.r === 8 ? ` and named ${SUIT_WORDS[suit]}` : ''}.${also.length ? ' ' + also.join(' ') : ''}`;
      addLog(t); say(t);
      netNote(who, 'p', c, c.r === 8 ? suit : -1);
      S.cursor = 0;
      next();
      return true;
    }
    /* twos: take the owed cards; the turn passes */
    function doTake(who) {
      const got = E.take(S.st);
      if (!got) { S.rejected++; return null; }
      snd.blip(200, 0.08, 'sine', 0.6, 150);
      S.pulse = performance.now();
      loop.kick(0.4);
      const n = got.length;
      const t = n ? `${nameOf(who)} took ${n} card${n === 1 ? '' : 's'}.` : `${nameOf(who)} owed cards, but there was nothing left to take.`;
      addLog(t); say(t);
      return got;
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
      netNote(who, 'd', c);
      return c;
    }
    function doPass(who) {
      if (!E.pass(S.st)) { S.rejected++; return; }
      const t = `${nameOf(who)} had nothing to play or draw, and passed.`;
      addLog(t); say(t);
      netNote(who, 'x');
      next();
    }

    function humanPlay(idx) {
      if (!myTurn() || S.choose >= 0) return false;
      const s = S.st, c = s.hands[s.turn][idx];
      if (!c || !E.playable(s, c)) {
        snd.blip(140, 0.08, 'sawtooth', 0.4);
        const why = !c ? 'No such card.'
          : s.pending ? `Only a two can go on a two now, or take ${s.pending} cards.`
            : c.r === 8 && s.rules.noEightOut && s.hands[s.turn].length === 1 ? 'You can’t go out on an eight (house rule): draw instead.'
              : c.r === 8 ? `Eights follow suit (house rule): this one needs ${SUIT_WORDS[s.suit]}.`
                : `The ${cardName(c)} doesn’t match the ${cardName(E.top(s))} or the suit ${SUIT_WORDS[s.suit]}.`;
        say(why);
        S.shake = performance.now(); loop.kick(0.3);
        return false;
      }
      if (c.r === 8) { S.choose = idx; pickEl.hidden = false; pickEl.querySelector('button')?.focus({ preventScroll: true }); say('Name a suit: 1 clubs, 2 diamonds, 3 hearts, 4 spades.'); paint(); return true; }
      if (guest) return netSend({ y: 'p', c: E.codeOf(c) });
      return doPlay(idx, undefined, s.turn);
    }
    function pickSuit(suit) {
      if (S.choose < 0) return;
      const idx = S.choose;
      S.choose = -1; pickEl.hidden = true;
      if (guest) { const c = S.st.hands[0][idx]; if (c) netSend({ y: 'p', c: E.codeOf(c), s: suit }); }
      else doPlay(idx, suit, S.st.turn);
      refocus();
    }
    function humanDraw() {
      if (!myTurn() || S.choose >= 0) return;
      if (!guest && E.canTake(S.st)) { doTake(S.st.turn); next(); return; }
      if (!E.mustDraw(S.st)) {
        snd.blip(140, 0.08, 'sawtooth', 0.4);
        say(E.legalPlays(S.st).length ? 'You have a card to play, so you can’t draw.' : S.st.drawn && S.rules.drawOne ? 'One card a turn (draw one): pass now.' : 'Nothing left to draw.');
        return;
      }
      if (guest) { netSend({ y: 'd' }); return; }
      doDraw(S.st.turn);
      next();
    }
    function humanPass() {
      if (!myTurn() || S.choose >= 0) return;
      if (!E.canPass(S.st)) {
        snd.blip(140, 0.08, 'sawtooth', 0.4);
        say(S.st.pending ? `Take ${S.st.pending} cards, or play a two.` : S.rules.drawOne ? 'Draw a card first; then you can pass.' : 'You can only pass when you have nothing to play and nothing to draw.');
        return;
      }
      if (guest) { netSend({ y: 'x' }); return; }
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
      if (mode === 'net') {
        /* both screens hold the same over (the guest's is the host's, turned round): the winner scores the points left in the other hand */
        const won = o.winner === 0;
        const me = won ? o.points : 0, them = won ? 0 : o.points;
        ctx.onEnd({ score: won ? o.points : null, won, versus: { me, them },
          detail: o.blocked
            ? `The hand was blocked: nobody could move. ${won ? 'You' : peerName} had the fewest points left and ${won ? 'score' : 'scores'} ${o.points}.`
            : won ? `You went out first and score ${o.points}, the points left in ${peerName}’s hand.` : `${peerName} went out first and scores ${o.points}, the points left in your hand.` });
        return;
      }
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
      else if (gl?.waiting) text = 'Sending your move…';
      else {
        const who = mode !== 'hot' ? 'Your turn: ' : `${nameOf(s.turn)}: `;
        const lit = E.legalPlays(s).length;
        if (s.pending) text = `${who}${lit ? 'play a two, or take' : 'take'} ${s.pending} cards`;
        else if (lit && E.canPass(s)) text = `${who}play a lit card, or pass`;
        else if (lit) text = mode !== 'hot' ? 'Your turn: play a lit card' : `${nameOf(s.turn)}: play a lit card`;
        else if (E.mustDraw(s)) text = `${mode !== 'hot' ? 'No play' : nameOf(s.turn) + ': no play'}: draw a card`;
        else if (s.drawn && s.rules.drawOne) text = `${who}nothing fits, so pass`;
        else text = 'Nothing to play or draw: pass';
      }
      statusEl.textContent = text;
      statusEl.classList.toggle('is-done', !!s.over);
      const mine = myTurn() && S.choose < 0;
      drawBtn.disabled = !(mine && (E.mustDraw(s) || E.canTake(s)));
      drawBtn.setLabel(s.pending ? `Take ${s.pending} cards` : 'Draw a card');
      passBtn.disabled = !(mine && E.canPass(s));
      sf.cv.setAttribute('aria-label', `Crazy Eights table. ${text}. Top card: ${cardName(E.top(s))}; suit in force: ${SUIT_WORDS[s.suit]}. ${handVisible() ? 'Your hand: ' + s.hands[viewer()].map(cardName).join(', ') : 'Hands are hidden.'}`);
      ctx.onScore(s.over && s.over.winner === 0 && mode !== 'hot' ? s.over.points : 0);
      draw();
    }

    /* ------------------------------ drawing ------------------------------ */
    /* "Larger cards" lifts the width limit and the cap, never the height one: the rows still fit */
    function layout() {
      const W = sf.w, H = sf.h, big = S.look.big;
      const cw = Math.round(Math.max(34, Math.min(W / (big ? 7 : 8.5), H / 4.1 / 1.4, big ? 124 : 96))), ch = Math.round(cw * 1.4);
      return { W, H, cw, ch, ocw: Math.round(cw * 0.56), och: Math.round(cw * 0.56 * 1.4), big };
    }
    const backOf = (w, hh) => book.back(w, hh, backHue(S.look, BACK_HUE), S.look.back);
    const faceOf = (c, w, hh) => book.face(c, w, hh, S.look.big);
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
      /* felt: the game's own dark table, or the one chosen under Table */
      const fc = feltColors(S.look);
      g.fillStyle = fc ? fc[1] : '#04120e';
      g.fillRect(0, 0, L.W, L.H);
      const felt = g.createRadialGradient(L.W / 2, L.H * 0.45, 0, L.W / 2, L.H * 0.45, Math.max(L.W, L.H) * 0.7);
      felt.addColorStop(0, fc ? fc[0] : 'hsla(160,60%,22%,.9)');
      felt.addColorStop(1, fc ? fc[1] : 'hsla(165,60%,6%,1)');
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
        for (let j = 0; j < shown; j++) g.drawImage(backOf(L.ocw, L.och), x0 + step * j, y, L.ocw, L.och);
        const turn = !s.over && s.turn === p;
        g.font = `${turn ? 800 : 650} ${Math.max(12, Math.round(L.cw * 0.2))}px ${FONT}`;
        g.textAlign = 'center';
        g.fillStyle = turn ? '#ffe28a' : 'rgba(255,255,255,.78)';
        g.fillText(`${nameOf(p)} · ${n} card${n === 1 ? '' : 's'}`, cx, y - 10);
        if (turn) { g.strokeStyle = 'rgba(255,226,138,.7)'; g.lineWidth = 2; rr(g, x0 - 5, y - 4, L.ocw + step * (shown - 1) + 10, L.och + 8, 7); g.stroke(); }
      });
      /* the two piles: in the middle, or for a left-handed table at the left, next to the panel */
      const midY = Math.round(L.H * 0.5 - L.ch / 2 + (others.length ? L.och * 0.2 : 0));
      const stockX = S.look.left ? Math.max(14, L.W * 0.08) : L.W / 2 - L.cw * 1.15, pileX = stockX + L.cw * 1.3;
      S.geoPiles = { stock: { x: stockX, y: midY, w: L.cw, h: L.ch }, pile: { x: pileX, y: midY, w: L.cw, h: L.ch } };
      if (s.stock.length) {
        for (let i = 2; i >= 0; i--) g.drawImage(backOf(L.cw, L.ch), stockX - i * 2, midY - i * 2, L.cw, L.ch);
        const can = myTurn() && (E.mustDraw(s) || E.canTake(s));
        if (can) { g.strokeStyle = 'rgba(255,226,138,.85)'; g.lineWidth = 3; rr(g, stockX - 3, midY - 3, L.cw + 6, L.ch + 6, L.cw * 0.09); g.stroke(); }
      } else { g.strokeStyle = 'rgba(255,255,255,.25)'; g.setLineDash([5, 5]); rr(g, stockX, midY, L.cw, L.ch, L.cw * 0.075); g.stroke(); g.setLineDash([]); }
      g.fillStyle = 'rgba(255,255,255,.6)'; g.font = `600 ${Math.max(11, Math.round(L.cw * 0.16))}px ${FONT}`; g.textAlign = 'center';
      g.fillText(`${s.stock.length} left`, stockX + L.cw / 2, midY + L.ch + 16);
      const topC = E.top(s), lift = !reduced && S.pulse && now - S.pulse < 320 ? Math.sin(((now - S.pulse) / 320) * Math.PI) * 8 : 0;
      if (s.pile.length > 1) g.drawImage(faceOf(s.pile[s.pile.length - 2], L.cw, L.ch), pileX - 4, midY + 2, L.cw, L.ch);
      g.drawImage(faceOf(topC, L.cw, L.ch), pileX, midY - lift, L.cw, L.ch);
      /* twos: the cards the player to move owes, on the pile */
      if (s.pending && !s.over) {
        const t = `Take ${s.pending}`, fs = Math.max(12, Math.round(L.cw * 0.19));
        g.font = `800 ${fs}px ${FONT}`;
        const tw = g.measureText(t).width + fs;
        g.fillStyle = '#d6203f'; rr(g, pileX + L.cw / 2 - tw / 2, midY - fs * 1.9, tw, fs * 1.5, fs * 0.75); g.fill();
        g.fillStyle = '#fff'; g.fillText(t, pileX + L.cw / 2, midY - fs * 0.78);
      }
      /* the suit in force */
      const bx = pileX + L.cw + 26, by = midY + L.ch / 2;
      g.fillStyle = '#fbfaf6'; g.beginPath(); g.arc(bx, by, Math.max(15, L.cw * 0.3), 0, Math.PI * 2); g.fill();
      drawSuit(g, s.suit, bx, by, Math.max(16, L.cw * 0.34));
      g.fillStyle = 'rgba(255,255,255,.6)'; g.font = `600 ${Math.max(11, Math.round(L.cw * 0.16))}px ${FONT}`;
      g.fillText('suit', bx, by + Math.max(15, L.cw * 0.3) + 15);
      /* aces: the order of play, once it has been turned round */
      if (s.dir < 0 && s.n > 2) {
        g.textAlign = 'left';
        g.fillStyle = '#ffe28a';
        g.fillText('↺ order reversed', pileX + L.cw + 8, by + Math.max(15, L.cw * 0.3) + 33);
        g.textAlign = 'center';
      }
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
        if (!vis) { g.drawImage(backOf(L.cw, L.ch), p.x, p.y, L.cw, L.ch); return; }
        g.drawImage(faceOf(c, L.cw, L.ch), x, y, L.cw, L.ch);
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
        g.fillText(`${nameOf(s.over.winner)} ${s.over.winner === 0 && mode !== 'hot' ? 'win' : 'wins'}! +${s.over.points}`, L.W / 2, L.H / 2 - L.ch * 0.1);
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
      if (!S.st || S.st.over) return;
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
      if (!ownsKey(el, e) || dead || !S.st || rulesOv || lookOv) return;
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

    if (NET && !guest) hl = hostLink(NET, { view: viewFor, act: netAct, dead: () => dead });
    if (guest) {
      gl = guestLink(NET, { show: showView, dead: () => dead });
      statusEl.textContent = `Waiting for ${peerName}’s deal…`;
    }
    newDeal();

    return {
      stop() {
        dead = true;
        hl?.stop(); gl?.stop();
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
        const s = S.st;
        const net = NET ? { role: guest ? 'guest' : 'host', step: (hl || gl)?.step ?? -1, waiting: !!gl?.waiting, rejected: S.rejected, linkRejected: hl ? hl.rejected : 0, last: hl ? hl.last : null, badViews: S.badViews } : null;
        if (!s) return { mode, net, waiting: true, status: statusEl.textContent };
        const v = viewer();
        /* the guest's table holds face-down placeholders for the host's cards: the rules are only asked about its own turn */
        const ask = fn => (guest && s.turn !== 0 && !s.over ? false : fn(s));
        const centre = b => ({ x: Math.round(b.x + b.w / 2), y: Math.round(b.y + b.h / 2) });
        const rect = b => ({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) });
        const sideR = side.getBoundingClientRect(), boardR = boardEl.getBoundingClientRect();
        return {
          mode, n: s.n, turn: s.turn, viewer: v, deals: S.deals,
          hand: handVisible() ? s.hands[v].map(E.codeOf) : null,
          counts: s.hands.map(x => x.length), top: E.codeOf(E.top(s)), suit: s.suit, stock: s.stock.length, pile: s.pile.length,
          legal: myTurn() ? E.legalPlays(s) : [], mustDraw: ask(E.mustDraw), mustPass: ask(E.mustPass), myTurn: myTurn(), cpuBusy: S.cpuBusy,
          canPass: ask(E.canPass), canTake: ask(E.canTake), pending: s.pending, dir: s.dir, drawn: s.drawn, net,
          /* what this screen knows of the other hand: only how many (online, the guest's are placeholders) */
          theirs: guest ? s.hands[1].map(c => (c === HIDDEN ? '?' : E.codeOf(c))) : null, log: S.log.slice(-10),
          /* the host's game deals the guest's hand, so it knows it (the tests compare it with the guest's screen) */
          seat1: NET && !guest ? s.hands[1].map(E.codeOf) : null,
          rules: { ...S.rules }, rulesText: rulesLine.textContent, note: note.textContent, rulesOpen: !!rulesOv, lookOpen: !!lookOv,
          covered: S.cover, choosing: S.choose >= 0, over: s.over ? { ...s.over } : null, plays: S.plays.slice(), rejected: S.rejected, ended: S.ended,
          cards: (S.geoHand || []).map(centre), stockAt: S.geoPiles ? centre(S.geoPiles.stock) : null, status: statusEl.textContent, reduced,
          drawLabel: drawBtn.textContent, buttons: { draw: !drawBtn.disabled, pass: !passBtn.disabled },
          /* the Table look in use, and where it put things (CSS px in the canvas; the panel's side of the board) */
          look: { ...S.look }, backHue: backHue(S.look, BACK_HUE),
          geo: S.geo ? { W: S.geo.W, H: S.geo.H, cw: S.geo.cw, ch: S.geo.ch, stock: S.geoPiles ? rect(S.geoPiles.stock) : null, pile: S.geoPiles ? rect(S.geoPiles.pile) : null,
            hand: (S.geoHand || []).map(rect), panel: sideR.x < boardR.x ? 'left' : 'right' } : null,
        };
      },
      /* test hook, inert unless a test calls it: lay out the hand in play.
         { set: { hands: [[codes] per player], top: code, stock: [codes drawn first → last], turn } } */
      hook: cmd => {
        const o = cmd?.set, s = S.st;
        if (!o || !s || s.over || guest) return false;     /* online, only the host's game is real */
        clearTimeout(S.timer);
        const P = list => list.map(E.parseCode).filter(Boolean);
        if (Array.isArray(o.hands)) o.hands.forEach((hd, p) => { if (p < s.n && Array.isArray(hd)) s.hands[p] = P(hd); });
        if (o.top) { s.pile = P([o.top]); s.suit = s.pile[0].s; }
        if (Array.isArray(o.stock)) s.stock = P(o.stock).reverse();
        if (Number.isInteger(o.turn)) s.turn = o.turn % s.n;
        Object.assign(s, { pending: 0, drawn: 0, passes: 0, idle: 0, dir: 1, fx: null });
        Object.assign(S, { cpuBusy: false, cursor: 0, choose: -1, plays: [] });
        pickEl.hidden = true;
        S.netLog = [];
        hl?.changed();
        next();
        return true;
      },
    };
  },
};
