/* ============================================================
   arcade/dice.js — Five Dice for Static Arcade.

   Roll five dice up to three times a turn, keeping the ones you
   like, then write the result in one of thirteen boxes. A full card
   is a game. The full rule set (upper bonus, Extra Five and how a
   spare five is placed) is in ./dice-rules.js and in the game's
   "Rules" panel.

   · 1P: a solo game for a high score, or against the computer
     (it plays the odds: it picks which dice to keep and which box
     to use from the exact chances of what a reroll can give — the
     search runs in a Web Worker). Remembered in portal.arcadeFiveDice.
   · 2P: two players on one screen, taking turns on their own cards.
   There is no undo: taking a roll back would let you reroll for luck.
   Dice come from crypto.getRandomValues (see ./dice-rules.js).

   Mouse or touch: click Roll, click dice to keep them, click a box
   on the card to score it. Keyboard: Space / R roll, 1–5 keep or
   release a die, ↑ ↓ choose a box and Enter writes the roll in it.
   Score: your card's total.
   ============================================================ */
import { h } from '../core/dom.js';
import { store } from '../core/store.js';
import * as D from './dice-rules.js';
import { thinker } from './thinker.js';
import { KIT_CSS, surface, ownsKey, sounder, looper, rr, playerStrip, segment, button } from './boardkit.js';

const PREF = 'portal.arcadeFiveDice';
const ROLL_MS = 420;

const CSS = `
.dc-card{flex:1 1 auto;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:1px;padding:4px;border-radius:var(--r-md,11px);background:var(--fill-0);border:1px solid var(--line-0)}
.dc-head,.dc-row,.dc-sum{display:grid;grid-template-columns:minmax(0,1fr) repeat(var(--np,1),44px);align-items:center;gap:4px;padding:0 6px;min-height:22px;font:600 var(--fs-12,12px)/1.2 var(--font,system-ui);color:var(--ink-1)}
.dc-head{color:var(--ink-3);font-size:var(--fs-11,11px);text-transform:uppercase;letter-spacing:.4px}
.dc-head span:not(:first-child),.dc-row .dc-v,.dc-sum span:not(:first-child){text-align:right;font-variant-numeric:tabular-nums}
.dc-row{border:0;border-radius:6px;background:transparent;cursor:pointer;text-align:left;width:100%}
.dc-row:nth-child(odd){background:rgba(255,255,255,.025)}
.dc-row[aria-disabled="true"]{cursor:default}
.dc-row .dc-v{color:var(--ink-0)}
.dc-row .dc-v.is-maybe{color:hsl(var(--h) 90% 75%);opacity:.9}
.dc-row.is-ok{box-shadow:inset 0 0 0 1px hsl(var(--h) 80% 60% / .25)}
.dc-row.is-cur{background:hsl(var(--h) 70% 50% / .22)}
.dc-row:focus-visible{outline:2px solid hsl(var(--h) 100% 72%);outline-offset:-2px}
@media (hover:hover){.dc-row.is-ok:hover{background:hsl(var(--h) 70% 50% / .22)}}
.dc-sum{color:var(--ink-2);font-weight:550}
.dc-sum.is-total{color:var(--ink-0);font-weight:800;border-top:1px solid var(--line-1);margin-top:2px}
.dc-v.is-me,.dc-head .is-me{color:hsl(var(--h) 100% 82%)}
.dc-rules{font-size:var(--fs-11,11px);line-height:1.45;color:var(--ink-3)}
.dc-rules summary{cursor:pointer;color:var(--ink-2);font-weight:650}
.dc-rules ul{margin:4px 0 0;padding-left:16px}
@container (max-aspect-ratio: 11/10){.dc-card{max-height:34cqh}.dc-rules{display:none}}
`;

const readPrefs = () => {
  let p = null;
  try { p = store.get(PREF, null); } catch (err) { p = null; }
  return { vs: p?.vs === 'cpu' ? 'cpu' : 'solo' };
};
const writePrefs = patch => { try { store.set(PREF, { ...readPrefs(), ...patch }); } catch (err) { /* a convenience */ } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  mount(el, ctx) {
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    const prefs = readPrefs();
    const two = ctx.players === 2;
    let mode = two ? '2p' : prefs.vs;                   /* 'solo' | 'cpu' | '2p' */
    let brain = mode === 'cpu' ? thinker() : null;
    let dead = false;
    let rng = D.makeRng(null);
    const namesFor = m => (m === 'solo' ? ['You'] : m === 'cpu' ? ['You', 'Computer'] : ['Player 1', 'Player 2']);
    let names = namesFor(mode);
    const NP = () => names.length;
    const COLORS = ['#4dd2ff', '#ffb84d'];

    const S = {
      cards: names.map(() => D.newCard()), p: 0, dice: [1, 2, 3, 4, 5], held: [false, false, false, false, false], rolls: 0,
      over: false, ended: false, endT: 0, rollT0: -1e9, thinking: false, runId: 0, cursor: 0, flash: '', geo: { dice: [] }, hover: -1, shake: 0, scored: 0,
    };
    const hue = Number(getComputedStyle(el).getPropertyValue('--h')) || 200;

    /* ------------------------------ the page ------------------------------ */
    const boardEl = h('div.arx-bg__board');
    const sr = h('div.arx-bg__sr', { 'aria-live': 'polite' });
    const statusEl = h('div.arx-bg__status', { role: 'status' });
    const strips = [0, 1].map(i => playerStrip(COLORS[i], namesFor(mode === 'solo' ? 'cpu' : mode)[i], ''));
    const vsSeg = !two ? segment('Play', [{ id: 'solo', label: 'Solo' }, { id: 'cpu', label: 'Vs computer' }], mode, v => { setVs(v); refocus(); }) : null;
    const rollBtn = button('Roll', 'refresh', () => { roll(); refocus(); }, { title: 'Roll the dice (Space or R)' });
    const note = h('div.arx-bg__note', { text: 'Click dice to keep them, then roll again or write the result in a box on the card.' });
    const rows = D.CATS.map(c => {
      const vals = [0, 1].map(i => h('span.dc-v', { dataset: { p: String(i) } }));
      const b = h('button.dc-row', { type: 'button', dataset: { cat: c.id }, title: c.hint, 'aria-label': `${c.name}: ${c.hint}`, onclick: () => { S.cursor = D.IDS.indexOf(c.id); score(c.id); refocus(); } },
        h('span', { text: c.name }), ...vals);
      return { b, vals, id: c.id };
    });
    const sum = (label, cls) => { const vals = [0, 1].map(() => h('span')); return { el: h(`div.dc-sum${cls || ''}`, h('span', { text: label }), ...vals), vals }; };
    const sUp = sum('Upper (63 for +35)'), sBonus = sum('Upper bonus'), sExtra = sum('Extra Fives'), sTotal = sum('Total', '.is-total');
    const headCols = [0, 1].map(i => h('span', { text: namesFor(mode === 'solo' ? 'cpu' : mode)[i].replace('Player ', 'P') }));
    const head = h('div.dc-head', h('span', { text: 'Box' }), ...headCols);
    const card = h('div.dc-card', { role: 'group', 'aria-label': 'Score card', style: { '--np': String(NP()), '--h': String(hue) } },
      head, ...rows.slice(0, 6).map(r => r.b), sUp.el, sBonus.el, ...rows.slice(6).map(r => r.b), sExtra.el, sTotal.el);
    const rules = h('details.dc-rules', h('summary', { text: 'Rules' }), h('ul',
      h('li', { text: 'Five dice, 13 turns, one box per turn. Roll up to three times, keeping any dice; you may stop early.' }),
      h('li', { text: 'Ones to Sixes: the sum of that number. 63 or more in the upper boxes earns +35.' }),
      h('li', { text: 'Three / Four Alike: sum of all dice. Full House 25. Small Run (4 in order) 30. Large Run (5 in order) 40. Five Alike 50. Chance: sum.' }),
      h('li', { text: 'Extra Five: after scoring 50 in Five Alike, each further Five Alike earns +100. It must go in its own number box if open, else any open lower box (Full House, runs score in full), else a zero in an upper box.' })));
    const side = h('div.arx-bg__side', ...strips.map(s => s.el), statusEl, vsSeg?.el, h('div.arx-bg__row', rollBtn), card, rules, note);
    const root = h('div.arx-bgc', h('style', { text: KIT_CSS + CSS + '\n.arx-bg [hidden]{display:none!important}' }), h('div.arx-bg', boardEl, side), sr);
    el.appendChild(root);
    const sf = surface(boardEl, 'Five Dice table', () => draw());
    const loop = looper(() => draw());
    const refocus = () => el.closest('[tabindex]')?.focus({ preventScroll: true });
    /* Solo / Vs computer: the card keeps two columns, the second is hidden while playing solo */
    function layoutMode() {
      names = namesFor(mode);
      const n = NP();
      card.style.setProperty('--np', String(n));
      strips[1].el.hidden = n < 2;
      headCols.forEach((c, i) => { c.textContent = names[i] ? names[i].replace('Player ', 'P') : ''; c.hidden = !names[i]; });
      const cols = i => [...card.querySelectorAll(`[data-p="${i}"]`)];
      cols(1).forEach(c => { c.hidden = n < 2; });
      [sUp, sBonus, sExtra, sTotal].forEach(x => { x.vals[1].hidden = n < 2; });
      strips.forEach((st, i) => { if (names[i]) st.set({ name: names[i] }); });
    }
    function setVs(v) {
      if (two || v === mode) return;
      mode = v;
      writePrefs({ vs: v });
      if (mode === 'cpu' && !brain) brain = thinker();
      vsSeg?.set(v);
      layoutMode();
      newGame();
    }

    /* ------------------------------ rules glue ------------------------------ */
    const mine = () => mode !== 'cpu' || S.p === 0;
    const rolling = () => performance.now() - S.rollT0 < ROLL_MS && !reduced;
    const canAct = () => !dead && !S.over && !S.thinking && mine();
    const card0 = () => S.cards[S.p];

    function newGame() {
      clearTimeout(S.endT);
      S.runId++;
      Object.assign(S, { cards: names.map(() => D.newCard()), p: 0, dice: [1, 2, 3, 4, 5], held: [false, false, false, false, false], rolls: 0, over: false, ended: false, thinking: false, flash: '', scored: 0, rollT0: -1e9 });
      ctx.onScore(0);
      paint();
    }

    function roll() {
      if (!canAct() || rolling()) return false;
      if (S.rolls >= 3) return flash('No rolls left this turn: pick a box for your dice.');
      if (S.rolls > 0 && S.held.every(Boolean)) return flash('You are keeping every die. Release one to roll it, or pick a box.');
      doRoll();
      return true;
    }
    function doRoll() {
      S.dice = D.roll(rng, S.dice, S.rolls === 0 ? null : S.held);
      S.rolls++;
      S.rollT0 = performance.now();
      S.flash = '';
      if (S.rolls === 1) S.held = [false, false, false, false, false];
      snd.blip(200, 0.05, 'square', 0.5);
      if (!reduced) for (let k = 1; k < 5; k++) setTimeout(() => snd.blip(160 + Math.random() * 120, 0.04, 'square', 0.35), k * 70);
      loop.kick(ROLL_MS / 1000 + 0.1);
      say(`Roll ${S.rolls}: ${S.dice.join(', ')}.`);
      paint();
    }
    function flash(t) { S.flash = t; S.shake = performance.now(); snd.blip(140, 0.08, 'sawtooth', 0.4); loop.kick(0.25); paint(); return false; }

    function toggle(i) {
      if (!canAct() || rolling()) return false;
      if (S.rolls === 0) return flash('Roll first, then choose which dice to keep.');
      if (S.rolls >= 3) return flash('That was your last roll: pick a box.');
      S.held[i] = !S.held[i];
      snd.blip(S.held[i] ? 420 : 340, 0.04, 'triangle', 0.5);
      say(`Die ${i + 1}, ${S.dice[i]}, ${S.held[i] ? 'kept' : 'released'}.`);
      paint();
      return true;
    }

    function score(cat) {
      if (!canAct() || rolling()) return false;
      if (S.rolls === 0) return flash('Roll the dice first.');
      const c = card0();
      if (c.s[cat] !== null) return flash('That box is already used.');
      if (!D.allowed(c, S.dice).includes(cat)) {
        const jk = D.isExtraFive(c, S.dice);
        return flash(jk ? 'Extra Five: it must go in its own number box if open, else a lower box.' : 'That box is already used.');
      }
      commit(cat);
      return true;
    }
    function commit(cat) {
      const c = card0();
      const extra = D.isExtraFive(c, S.dice) && c.s.five === 50;
      const pts = D.fill(c, S.dice, cat);
      S.scored++;
      snd.blip(pts ? 520 : 200, 0.1, 'triangle', 0.8, pts ? 760 : 120);
      say(`${names[S.p]} scored ${pts} in ${D.CATS[D.IDS.indexOf(cat)].name}${extra ? ', plus a 100 bonus for an extra five' : ''}.`);
      S.flash = extra ? 'Extra Five: +100 bonus!' : '';
      if (D.isFull(c) && S.cards.every(D.isFull)) { S.over = true; S.rolls = 0; paint(); loop.kick(1); finishSoon(); return; }
      /* next turn: the next player who still has boxes (all have the same count, so just rotate) */
      S.p = (S.p + 1) % NP();
      S.held = [false, false, false, false, false];
      S.rolls = 0;
      S.rollT0 = -1e9;
      S.cursor = Math.max(0, D.IDS.findIndex(id => card0().s[id] === null));
      paint();
      if (mode === 'cpu' && S.p === 1) computerTurn();
    }

    async function computerTurn() {
      const run = ++S.runId;
      S.thinking = true;
      paint();
      const alive = () => !dead && run === S.runId;
      const pace = reduced ? 120 : 620;
      await sleep(pace);
      if (!alive()) return;
      doRoll();
      await sleep(reduced ? 80 : ROLL_MS + 250);
      while (alive() && S.rolls < 3) {
        const res = await brain.ask({ game: 'dice', card: S.cards[1], dice: S.dice, left: 3 - S.rolls });
        if (!alive()) return;
        if (!res || !Array.isArray(res.hold)) break;
        if (res.hold.every(Boolean)) break;
        S.held = res.hold.slice();
        paint();
        await sleep(reduced ? 80 : 650);
        if (!alive()) return;
        doRoll();
        await sleep(reduced ? 80 : ROLL_MS + 250);
      }
      if (!alive()) return;
      const pick = await brain.ask({ game: 'dice', card: S.cards[1], dice: S.dice, left: 0 });
      if (!alive()) return;
      const cat = pick && D.allowed(S.cards[1], S.dice).includes(pick.cat) ? pick.cat : D.allowed(S.cards[1], S.dice)[0];
      S.thinking = false;
      S.held = [false, false, false, false, false];
      S.cursor = D.IDS.indexOf(cat);
      paint();
      await sleep(reduced ? 80 : 500);
      if (!alive()) return;
      commit(cat);
    }

    function finishSoon() {
      clearTimeout(S.endT);
      S.endT = setTimeout(finish, reduced ? 300 : 1300);
    }
    function finish() {
      if (S.ended || dead || !S.over) return;
      S.ended = true;
      paint();
      const t = S.cards.map(c => D.totals(c));
      const mineT = t[0].total;
      if (mode === '2p') {
        const w = t[0].total === t[1].total ? -1 : t[0].total > t[1].total ? 0 : 1;
        ctx.onEnd({ score: null, detail: w < 0 ? `A tie at ${t[0].total} each.` : `${names[w]} wins, ${t[w].total} to ${t[1 - w].total}.` });
      } else if (mode === 'cpu') {
        const bits = `You ${mineT}, the computer ${t[1].total}.`;
        ctx.onEnd({ score: mineT, ...(mineT === t[1].total ? {} : { won: mineT > t[1].total }), detail: mineT === t[1].total ? `A tie. ${bits}` : bits });
      } else {
        const x = t[0];
        ctx.onEnd({ score: mineT, detail: `${x.upper} in the upper boxes${x.bonus ? ' (bonus +35)' : ''}, ${x.lower} in the lower${x.extra ? `, ${x.extra} for extra fives` : ''}.` });
      }
    }

    /* ------------------------------ text and card ------------------------------ */
    function say(t) { sr.textContent = t; }
    function paint() {
      if (dead) return;
      const c = card0();
      const tot = S.cards.map(D.totals);
      let text;
      if (S.over) {
        if (mode === 'solo') text = `Card full: ${tot[0].total} points.`;
        else if (tot[0].total === tot[1].total) text = `A tie at ${tot[0].total}.`;
        else { const w = tot[0].total > tot[1].total ? 0 : 1; text = mode === 'cpu' ? (w === 0 ? `You win, ${tot[0].total} to ${tot[1].total}!` : `The computer wins, ${tot[1].total} to ${tot[0].total}.`) : `${names[w]} wins, ${tot[w].total} to ${tot[1 - w].total}!`; }
      } else if (S.thinking) text = 'The computer is playing…';
      else if (S.rolls === 0) text = mode === '2p' ? `${names[S.p]}: roll the dice` : 'Roll the dice';
      else if (S.rolls < 3) text = `Roll ${S.rolls} of 3: keep dice and roll again, or pick a box`;
      else text = 'Last roll: pick a box for your dice';
      if (S.flash && !S.over) text = S.flash;
      statusEl.textContent = text;
      statusEl.classList.toggle('is-alert', !!S.flash && /^(No rolls|Roll first|You are keeping|That|Roll the|Extra Five: it)/.test(S.flash));
      statusEl.classList.toggle('is-done', S.over);
      strips.forEach((st, i) => {
        const t = tot[i];
        if (!t) return;
        const done = D.CATS.length - D.open(S.cards[i]).length;
        st.set({ note: `${t.total} points · ${done} of 13 boxes`, turn: !S.over && S.p === i, thinking: S.thinking && i === 1 });
      });
      rollBtn.setLabel(S.rolls === 0 ? 'Roll' : `Roll again (${3 - S.rolls} left)`);
      rollBtn.disabled = !canAct() || S.rolls >= 3 || (S.rolls > 0 && S.held.every(Boolean));
      const allowedNow = S.rolls > 0 && canAct() ? new Set(D.allowed(c, S.dice)) : new Set();
      rows.forEach(r => {
        r.vals.forEach((v, pi) => {
          if (!S.cards[pi]) { v.textContent = ''; return; }
          const val = S.cards[pi].s[r.id];
          const maybe = pi === S.p && val === null && allowedNow.has(r.id);
          v.textContent = val !== null ? String(val) : maybe ? `+${D.scoreFor(S.cards[pi], S.dice, r.id)}` : '';
          v.classList.toggle('is-maybe', maybe);
          v.classList.toggle('is-me', pi === S.p && !S.over);
        });
        r.b.setAttribute('aria-disabled', String(!allowedNow.has(r.id)));
        r.b.classList.toggle('is-ok', allowedNow.has(r.id));
        r.b.classList.toggle('is-cur', D.IDS[S.cursor] === r.id && canAct());
      });
      tot.forEach((t, i) => {
        sUp.vals[i].textContent = `${t.upper}/63`;
        sBonus.vals[i].textContent = t.bonus ? `+${t.bonus}` : t.toBonus ? `${t.toBonus} to go` : '';
        sExtra.vals[i].textContent = t.extra ? `+${t.extra}` : '';
        sTotal.vals[i].textContent = String(t.total);
      });
      sf.cv.setAttribute('aria-label', `Five Dice table. ${text}. Dice: ${S.rolls ? S.dice.join(', ') : 'not rolled'}.`);
      ctx.onScore(tot[0].total);
      draw();
    }

    /* ------------------------------ drawing ------------------------------ */
    const PIPS = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] };
    function drawDie(g, x, y, s, v, held, tilt, dim) {
      g.save();
      g.translate(x + s / 2, y + s / 2);
      g.rotate(tilt);
      if (held) { g.shadowColor = `hsl(${hue} 100% 65%)`; g.shadowBlur = s * 0.35; }
      else { g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = s * 0.2; g.shadowOffsetY = s * 0.06; }
      const gr = g.createLinearGradient(-s / 2, -s / 2, s / 2, s / 2);
      gr.addColorStop(0, '#ffffff');
      gr.addColorStop(1, held ? '#bfe6ff' : '#d6d8e4');
      g.fillStyle = gr;
      rr(g, -s / 2, -s / 2, s, s, s * 0.18);
      g.fill();
      g.shadowBlur = 0; g.shadowOffsetY = 0;
      if (held) { g.strokeStyle = `hsl(${hue} 100% 60%)`; g.lineWidth = Math.max(2, s * 0.05); rr(g, -s / 2, -s / 2, s, s, s * 0.18); g.stroke(); }
      g.fillStyle = dim ? 'rgba(30,32,48,.35)' : '#1c1f33';
      const pr = s * 0.085, sp = s * 0.25;
      if (v) for (const [dx, dy] of PIPS[v]) { g.beginPath(); g.arc(dx * sp, dy * sp, pr, 0, Math.PI * 2); g.fill(); }
      g.restore();
    }
    function draw() {
      if (dead) return;
      const g = sf.g;
      sf.begin();
      const now = performance.now();
      g.fillStyle = '#05060d';
      g.fillRect(0, 0, sf.w, sf.h);
      const glow = g.createRadialGradient(sf.w / 2, sf.h * 0.5, 0, sf.w / 2, sf.h * 0.5, Math.max(sf.w, sf.h) * 0.65);
      glow.addColorStop(0, `hsla(${hue},70%,38%,.28)`);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = glow;
      g.fillRect(0, 0, sf.w, sf.h);
      const s = Math.max(24, Math.min(sf.h * 0.28, (sf.w - 24) / 5.6));
      const gap = s * 0.2, total = s * 5 + gap * 4, x0 = (sf.w - total) / 2, y0 = sf.h * 0.5 - s / 2;
      S.geo.dice = [];
      const anim = rolling();
      for (let i = 0; i < 5; i++) {
        const x = x0 + i * (s + gap);
        const held = S.held[i] && S.rolls > 0 && S.rolls < 3;
        const lift = held ? -s * 0.22 : 0;
        const spin = anim && (S.rolls === 1 || !S.held[i]);
        const v = S.rolls === 0 ? 0 : spin ? 1 + Math.floor(((now / 55 + i * 7) * 1.7) % 6) : S.dice[i];
        const tilt = spin ? Math.sin(now / 45 + i) * 0.28 : 0;
        const yy = y0 + lift + (spin ? Math.sin(now / 70 + i * 2) * s * 0.06 : 0);
        drawDie(g, x, yy, s, v, held, tilt, S.rolls === 0);
        S.geo.dice.push({ x, y: y0 - s * 0.22, w: s, h: s * 1.22 });
        g.fillStyle = held ? `hsl(${hue} 100% 80%)` : 'rgba(190,200,230,.5)';
        g.font = `600 ${Math.max(10, s * 0.17)}px system-ui, sans-serif`;
        g.textAlign = 'center';
        g.fillText(held ? 'KEPT' : S.rolls > 0 && S.rolls < 3 ? `${i + 1}` : `${i + 1}`, x + s / 2, y0 + s * 1.32);
      }
      if (S.shake && now - S.shake < 200) { g.strokeStyle = `rgba(255,90,110,${1 - (now - S.shake) / 200})`; g.lineWidth = 3; g.strokeRect(x0 - 8, y0 - s * 0.4, total + 16, s * 1.9); }
      g.fillStyle = 'rgba(210,220,250,.75)';
      g.font = `600 ${Math.max(12, s * 0.2)}px system-ui, sans-serif`;
      g.textAlign = 'center';
      const msg = S.over ? 'Card full' : S.thinking ? 'The computer is rolling…' : S.rolls === 0 ? 'Roll to start your turn' : S.rolls < 3 ? `Roll ${S.rolls} of 3 — click a die to keep it` : 'Last roll — pick a box';
      g.fillText(msg, sf.w / 2, y0 - s * 0.62);
      /* the roll pips: three small lights */
      for (let k = 0; k < 3; k++) {
        g.fillStyle = k < S.rolls ? `hsl(${hue} 100% 68%)` : 'rgba(255,255,255,.18)';
        g.beginPath(); g.arc(sf.w / 2 + (k - 1) * s * 0.28, y0 + s * 1.75, s * 0.06, 0, Math.PI * 2); g.fill();
      }
    }

    /* ------------------------------ input ------------------------------ */
    const dieAt = (x, y) => S.geo.dice.findIndex(d => x >= d.x && x <= d.x + d.w && y >= d.y && y <= d.y + d.h);
    const onDown = e => {
      if (e.button > 0 || dead) return;
      snd.wake();
      const r = sf.cv.getBoundingClientRect();
      const i = dieAt(e.clientX - r.left, e.clientY - r.top);
      if (i >= 0) toggle(i);
    };
    const onMove = e => {
      const r = sf.cv.getBoundingClientRect();
      const i = dieAt(e.clientX - r.left, e.clientY - r.top);
      sf.cv.style.cursor = i >= 0 && canAct() && S.rolls > 0 && S.rolls < 3 ? 'pointer' : 'default';
    };
    const onKey = e => {
      if (!ownsKey(el, e) || dead || S.ended) return;
      const k = e.key;
      if (k === ' ' || k === 'r' || k === 'R') { e.preventDefault(); snd.wake(); roll(); return; }
      if (/^[1-5]$/.test(k)) { e.preventDefault(); snd.wake(); toggle(Number(k) - 1); return; }
      if (k === 'ArrowUp' || k === 'ArrowDown') {
        e.preventDefault();
        const open = D.IDS.map((id, i) => i).filter(i => card0().s[D.IDS[i]] === null);
        if (!open.length) return;
        let at = open.indexOf(S.cursor);
        if (at < 0) at = 0; else at = (at + (k === 'ArrowDown' ? 1 : -1) + open.length) % open.length;
        S.cursor = open[at];
        paint();
        return;
      }
      if (k === 'Enter') { e.preventDefault(); snd.wake(); score(D.IDS[S.cursor]); }
    };
    window.addEventListener('keydown', onKey);
    sf.cv.addEventListener('pointerdown', onDown);
    sf.cv.addEventListener('pointermove', onMove);

    layoutMode();
    newGame();

    return {
      stop() {
        dead = true;
        S.runId++;
        clearTimeout(S.endT);
        brain?.close();
        loop.stop();
        window.removeEventListener('keydown', onKey);
        sf.cv.removeEventListener('pointerdown', onDown);
        sf.cv.removeEventListener('pointermove', onMove);
        snd.close();
        sf.destroy();
        root.remove();
      },
      /* test hook (inert unless a test calls it): 'seed' restarts the game on a repeatable dice sequence */
      hook(cmd, arg) {
        if (cmd === 'seed') { rng = D.makeRng(arg); newGame(); return true; }
        return false;
      },
      peek: () => ({
        mode, names, p: S.p, dice: S.dice.slice(), held: S.held.slice(), rolls: S.rolls, rolling: rolling(), over: S.over, ended: S.ended,
        cards: S.cards.map(c => ({ ...c.s })), extra: S.cards.map(c => c.extra), totals: S.cards.map(D.totals), thinking: S.thinking, worker: !!brain?.worker,
        allowed: S.rolls ? D.allowed(card0(), S.dice) : [], cursor: D.IDS[S.cursor], geo: { dice: S.geo.dice.map(d => ({ ...d })) }, status: statusEl.textContent, scored: S.scored,
      }),
    };
  },
};
