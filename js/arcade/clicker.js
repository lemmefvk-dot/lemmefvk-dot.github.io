/* ============================================================
   arcade/clicker.js — Static Clicker for Static Arcade.

   A signal is lost in the static. Click to tune a little of it in,
   buy antennas, dishes and satellites that tune it for you, and lock
   the signal by collecting 10 billion Static in one run — the end of
   the game. A Reboot starts the run over for Clarity, +10% to
   everything, if you'd like to get there faster.

   It plays itself while you're away, up to 8 hours' worth at your
   rate, and tells you what it credited. Nothing here costs money,
   shows ads, counts down, or asks you to come back.

   Controls
     mouse / touch  Tune button · buy buttons
     keyboard       Space / Enter tune · 1-9 buy that generator ·
                    U buy the cheapest upgrade you can afford ·
                    B cycles how many you buy at once
   Score = seconds of play to lock the signal (time away that the
   game credited counts), lower is better. Saved on this device
   (portal.arcadePuzzles.clicker).
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { ownsKey, sounder } from './kit.js';
import { CSS as BASE, load, save, reducedMotion, bag } from './puzzlekit.js';
import * as L2 from './clicker-logic.js';

const { GENS, GOAL, OFFLINE_CAP_HOURS, fmt, fmtDuration } = L2;
const GAME = 'clicker';
const QTYS = [1, 10, 100, 'max'];

const CSS = `${BASE}
.pz-ck{display:grid;grid-template-columns:minmax(220px,1fr) minmax(260px,1.3fr);gap:var(--sp-4,12px);width:min(100%,900px);flex:1 1 auto;min-height:0;overflow:hidden}
.pz-ck__left,.pz-ck__right{display:flex;flex-direction:column;gap:10px;min-height:0}
.pz-ck__left{position:relative;align-items:center;text-align:center;overflow:auto}
.pz-ck__right{overflow:auto;padding-right:4px}
@container (max-width:640px){.pz-ck{grid-template-columns:1fr;overflow:auto}.pz-ck__left,.pz-ck__right{overflow:visible}}
.pz-ck__total{font-size:clamp(28px,7cqmin,44px);font-weight:800;color:#fff;font-variant-numeric:tabular-nums;line-height:1.05}
.pz-ck__total small{display:block;font-size:12px;font-weight:600;color:var(--ink-3,#999);letter-spacing:.04em;text-transform:uppercase}
.pz-ck__rate{font-size:14px;color:var(--ink-2,#bbb);font-variant-numeric:tabular-nums}
.pz-ck__tune{position:relative;width:clamp(120px,26cqmin,180px);aspect-ratio:1;border-radius:50%;border:0;cursor:pointer;color:#fff;font:800 15px/1.2 var(--font,system-ui);
  background:radial-gradient(circle at 35% 30%,hsl(275,85%,72%),hsl(275,75%,50%) 60%,hsl(275,70%,32%));box-shadow:0 0 28px hsla(275,90%,60%,.45),inset 0 -6px 0 rgba(0,0,0,.25);flex:0 0 auto}
.pz:not(.is-reduced) .pz-ck__tune{transition:transform .06s}
.pz:not(.is-reduced) .pz-ck__tune:active{transform:scale(.95)}
.pz-ck__tune:focus-visible{outline:3px solid var(--ga);outline-offset:3px}
.pz-ck__tune span{display:block;font-size:11px;font-weight:600;opacity:.85}
.pz-ck__bar{width:100%;height:12px;border-radius:99px;background:var(--fill-1,rgba(255,255,255,.08));overflow:hidden;border:1px solid var(--line-1,rgba(255,255,255,.1))}
.pz-ck__bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,hsl(275,80%,55%),hsl(190,90%,55%))}
.pz:not(.is-reduced) .pz-ck__bar i{transition:width .25s}
.pz-ck__goal{font-size:12px;color:var(--ink-2,#bbb);font-variant-numeric:tabular-nums}
.pz-ck__h{margin:4px 0 0;font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-3,#999);display:flex;align-items:center;justify-content:space-between;gap:8px}
.pz-ck__list{display:flex;flex-direction:column;gap:6px}
.pz-ck__row{display:grid;grid-template-columns:1fr auto;gap:2px 10px;align-items:center;text-align:left;padding:8px 10px;border-radius:10px;cursor:pointer;color:var(--ink-1,#ddd);
  background:var(--fill-1,rgba(255,255,255,.06));border:1px solid var(--line-1,rgba(255,255,255,.1));font:600 13px/1.25 var(--font,system-ui)}
.pz-ck__row:focus-visible{outline:2px solid var(--ga);outline-offset:2px}
.pz-ck__row:disabled{opacity:.5;cursor:default}
@media (hover:hover){.pz-ck__row:not(:disabled):hover{background:var(--fill-2,rgba(255,255,255,.12))}}
.pz-ck__row small{grid-column:1/-1;font-weight:500;font-size:11px;color:var(--ink-3,#999)}
.pz-ck__row b{font-variant-numeric:tabular-nums}
.pz-ck__row .n{color:var(--ink-3,#999);font-weight:700}
.pz-ck__note{font-size:11px;color:var(--ink-3,#999);line-height:1.4;max-width:46ch}
.pz-ck__banner{width:100%;padding:8px 10px;border-radius:10px;background:color-mix(in srgb,var(--ga) 16%,transparent);border:1px solid color-mix(in srgb,var(--ga) 45%,transparent);font-size:12px;color:var(--ink-1,#ddd);text-align:left;display:flex;gap:8px;align-items:flex-start}
.pz-ck__banner button{margin-left:auto;flex:0 0 auto}
.pz-ck__pop{position:absolute;pointer-events:none;font-weight:800;color:#fff;text-shadow:0 1px 4px rgba(0,0,0,.6);font-size:15px;animation:pz-ck-pop .8s ease-out forwards}
@keyframes pz-ck-pop{from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(-46px)}}
.pz-ck__card{position:absolute;inset:0;pointer-events:none;display:grid;place-items:center;z-index:6;background:rgba(10,8,16,.86);text-align:center;padding:16px}
.pz-ck__card b{display:block;font-size:24px;margin-bottom:6px;color:#fff}
.pz-ck__card span{display:block;font-size:13px;color:var(--ink-2,#bbb);max-width:44ch;margin:0 auto}
`;

export default {
  mount(el, ctx = {}) {
    const onScore = typeof ctx.onScore === 'function' ? ctx.onScore : () => {};
    const onEnd = typeof ctx.onEnd === 'function' ? ctx.onEnd : () => {};
    const reduced = reducedMotion(ctx);
    const B = bag();
    const snd = sounder(ctx);
    let dead = false, paused = false, ended = false;
    const sv = load(GAME);
    const S = L2.deserialize(sv.state, Date.now());
    let qtyI = QTYS.includes(sv.qty) ? QTYS.indexOf(sv.qty) : 0;
    let wins = Number(sv.wins) || 0;
    let away = null;                      /* what the game credited for time away, shown once */
    let bannerFor = null;
    let confirm = '';                     /* 'reboot' | 'reset': a second press is needed */
    let confirmTimer = 0, upKey = '', saveTimer = 0, lastNow = performance.now(), iv = 0, lastClickSound = 0;

    /* ----- what the clock is worth since the last save ----- */
    const rep = L2.applyAway(S, Date.now());
    if (rep.credited >= 30) away = rep;

    /* ----- the page ----- */
    const totalV = h('div.pz-ck__total', { 'aria-live': 'off' });
    const rateV = h('div.pz-ck__rate');
    const tune = h('button.pz-ck__tune', { type: 'button', title: 'Tune the signal (Space)' }, h('div', { text: 'Tune' }), h('span', { text: '' }));
    const barFill = h('i');
    const bar = h('div.pz-ck__bar', { role: 'progressbar', 'aria-label': 'Signal lock', 'aria-valuemin': '0', 'aria-valuemax': '100' }, barFill);
    const goalV = h('div.pz-ck__goal');
    const bannerBox = h('div', { style: { width: '100%' } });
    const note = h('p.pz-ck__note', { text: `While this is closed it keeps working for you, up to ${OFFLINE_CAP_HOURS} hours' worth at the rate you left it at, never more. No ads, no purchases, and nothing to come back for. Locking the signal at ${fmt(GOAL)} Static in one run finishes the game.` });
    const left = h('div.pz-ck__left', totalV, rateV, tune, bar, goalV, bannerBox, note);

    const qtyBtns = QTYS.map((q, i) => h('button', { type: 'button', dataset: { qty: String(q) }, 'aria-pressed': 'false', text: q === 'max' ? 'Max' : `×${q}`, title: 'How many to buy at once (B)' }));
    const qtySeg = h('div.pz__seg', { role: 'group', 'aria-label': 'Buy amount' }, ...qtyBtns);
    const genRows = GENS.map((g, i) => {
      const nameN = h('span', { text: g.name }), cnt = h('span.n', { text: '0' }), costV = h('b', { text: '' }), rateT = h('small', { text: '' });
      const b = h('button.pz-ck__row', { type: 'button', dataset: { gen: String(i) }, title: `${g.blurb} (key ${i + 1})` },
        h('span', nameN, document.createTextNode(' '), cnt), costV, rateT);
      return { b, cnt, costV, rateT, i };
    });
    const upList = h('div.pz-ck__list', { 'aria-label': 'Upgrades' });
    const upHead = h('div.pz-ck__h', h('span', { text: 'Upgrades' }));
    const rebootNote = h('small.pz-ck__note');
    const rebootBtn = h('button.pz__btn', { type: 'button' }, icon('refresh'), h('span', { text: 'Reboot' }));
    const resetBtn = h('button.pz__btn', { type: 'button', title: 'Erase everything and begin a new game' }, h('span', { text: 'New game' }));
    const right = h('div.pz-ck__right',
      h('div.pz-ck__h', h('span', { text: 'Generators' }), qtySeg),
      h('div.pz-ck__list', ...genRows.map(r => r.b)),
      upHead, upList,
      h('div.pz-ck__h', h('span', { text: 'Reboot' })), rebootNote, h('div', rebootBtn),
      h('div.pz-ck__h', h('span', { text: 'Game' })), h('div', resetBtn));
    const live = h('div.pz__live', { 'aria-live': 'polite' });
    const root = h('div.pz' + (reduced ? '.is-reduced' : ''), { style: { '--ga': ctx.accent || 'var(--accent, #ff456d)' } },
      h('style', { text: CSS }), h('div.pz-ck', left, right), live);
    el.appendChild(root);
    const say = m => { live.textContent = ''; live.textContent = m; };

    /* ----- view ----- */
    const qty = () => QTYS[qtyI];
    function paint() {
      totalV.replaceChildren(document.createTextNode(fmt(S.static)), h('small', { text: 'Static' }));
      const r = L2.rate(S);
      rateV.textContent = `${fmt(r)} per second`;
      tune.lastChild.textContent = `+${fmt(L2.clickValue(S))} a click`;
      const pct = Math.min(100, 100 * S.lifetime / GOAL);
      barFill.style.width = `${pct}%`;
      bar.setAttribute('aria-valuenow', String(Math.round(pct)));
      bar.setAttribute('aria-valuetext', `${pct.toFixed(1)} percent locked`);
      goalV.textContent = `Signal lock ${pct < 10 ? pct.toFixed(1) : Math.floor(pct)}% — ${fmt(S.lifetime)} of ${fmt(GOAL)} Static this run${S.clarity ? ` · Clarity ${S.clarity} (+${S.clarity * 10}%)` : ''}`;
      qtyBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.qty === String(qty()))));
      for (const row of genRows) {
        const n = qty() === 'max' ? Math.max(1, L2.maxBuyable(S, row.i)) : qty();
        const cost = L2.costOfMany(S, row.i, n);
        row.cnt.textContent = String(S.count[row.i]);
        row.costV.textContent = `${n > 1 ? `${n} for ` : ''}${fmt(cost)}`;
        row.rateT.textContent = S.count[row.i] ? `${fmt(L2.genRate(S, row.i))} per second from ${S.count[row.i]}` : `each makes ${fmt(GENS[row.i].rate * L2.clarityMult(S))} per second`;
        row.b.disabled = ended || S.static < cost;
        row.b.setAttribute('aria-label', `${GENS[row.i].name}, you own ${S.count[row.i]}. Buy ${n} for ${fmt(cost)} Static.`);
      }
      const ups = L2.availableUpgrades(S).sort((a, b) => a.cost - b.cost).slice(0, 8);
      const key = ups.map(u => u.id).join();
      if (key !== upKey) {
        upKey = key;
        upList.replaceChildren(...(ups.length ? ups.map(u => {
          const b = h('button.pz-ck__row', { type: 'button', dataset: { up: u.id } }, h('span', { text: u.name }), h('b', { text: fmt(u.cost) }), h('small', { text: u.desc }));
          B.on(b, 'click', () => buyUp(u.id));
          return b;
        }) : [h('small.pz-ck__note', { text: 'Tune-ups appear as you own more of each generator.' })]));
      }
      upList.querySelectorAll('button').forEach(b => { const u = L2.upgradeById(b.dataset.up); b.disabled = ended || !u || S.static < u.cost; });
      const gain = L2.rebootGain(S);
      rebootNote.textContent = gain >= 1
        ? `Start over and keep ${gain} Clarity (+${gain * 10}% to everything, on top of the ${S.clarity * 10}% you have). Needs a second press to confirm.`
        : `Clarity comes from a Reboot: the first point needs ${fmt(L2.REBOOT_BASE)} Static in one run. You have collected ${fmt(S.lifetime)}.`;
      rebootBtn.disabled = ended || gain < 1;
      rebootBtn.lastChild.textContent = confirm === 'reboot' ? `Reboot for ${gain} Clarity? Press again` : 'Reboot';
      resetBtn.lastChild.textContent = confirm === 'reset' ? 'Erase everything? Press again' : 'New game';
      if (bannerFor !== away) {
        bannerFor = away;
        bannerBox.replaceChildren(...(away ? [h('div.pz-ck__banner', { role: 'status' },
          icon('clock'),
          h('span', { text: `Welcome back. You were away ${fmtDuration(away.away)}; ${away.capped ? `the game credits at most ${OFFLINE_CAP_HOURS} hours, so ` : ''}${fmtDuration(away.credited)} of work earned ${fmt(away.earned)} Static.` }),
          h('button.pz__btn', { type: 'button', title: 'Dismiss', 'aria-label': 'Dismiss', onclick: () => { away = null; paint(); } }, icon('x')))] : []));
      }
      onScore(Math.floor(S.runSeconds));
    }

    /* ----- saving ----- */
    function persistNow() { clearTimeout(saveTimer); saveTimer = 0; save(GAME, { state: L2.serialize(S, Date.now()), qty: qty(), wins }); }
    function persistSoon() { if (!saveTimer) saveTimer = setTimeout(() => { saveTimer = 0; if (!dead) persistNow(); }, 600); }

    /* ----- actions ----- */
    const pop = (text, x, y) => {
      if (reduced || !text) return;
      const p = h('span.pz-ck__pop', { text });
      p.style.left = `${x}px`; p.style.top = `${y}px`;
      tune.parentElement.appendChild(p);
      setTimeout(() => p.remove(), 850);
    };
    function doTune(e) {
      if (dead || paused || ended) return;
      const v = L2.click(S);
      const now = performance.now();
      if (now - lastClickSound > 60) { lastClickSound = now; snd.wake(); snd.blip(300 + Math.random() * 120, 0.03, 'square', 0.35); }
      if (e && typeof e.clientX === 'number' && tune.parentElement) {
        const r = left.getBoundingClientRect();
        pop(`+${fmt(v)}`, e.clientX - r.left - 12, e.clientY - r.top - 14);
      }
      paint(); persistSoon();
      if (S.won) win();
    }
    function buyGen(i) {
      if (dead || paused || ended) return;
      const q = qty(), n = L2.buy(S, i, q);
      if (n) { snd.wake(); snd.blip(480 + i * 40, 0.06, 'triangle', 0.6); say(`Bought ${n} ${GENS[i].name}${n > 1 ? 's' : ''}. You now own ${S.count[i]}.`); paint(); persistSoon(); }
    }
    function buyUp(id) {
      if (dead || paused || ended) return;
      if (L2.buyUpgrade(S, id)) { snd.wake(); snd.blip(660, 0.08, 'sine', 0.6); say(`Bought ${L2.upgradeById(id).name}.`); upKey = ''; paint(); persistSoon(); }
    }
    function arm(what) {
      confirm = what; clearTimeout(confirmTimer);
      confirmTimer = setTimeout(() => { confirm = ''; if (!dead) paint(); }, 4000);
      paint();
    }
    function doReboot() {
      if (L2.rebootGain(S) < 1 || ended) return;
      if (confirm !== 'reboot') return arm('reboot');
      confirm = ''; clearTimeout(confirmTimer);
      const gain = L2.reboot(S);
      upKey = ''; say(`Rebooted. You gained ${gain} Clarity.`); snd.blip(220, 0.2, 'sawtooth', 0.5, 440);
      paint(); persistNow();
    }
    function doReset() {
      if (ended) return;
      if (confirm !== 'reset') return arm('reset');
      confirm = ''; clearTimeout(confirmTimer);
      Object.assign(S, L2.newState(Date.now()));
      upKey = ''; away = null; say('A new game begins.');
      paint(); persistNow();
    }
    function win() {
      if (ended) return;
      ended = true; wins++;
      const secs = Math.round(S.runSeconds);
      const mins = fmtDuration(secs);
      /* the finished game is not kept: the next one starts clean (the wins stay) */
      save(GAME, { state: L2.serialize(L2.newState(Date.now()), Date.now()), wins });
      clearTimeout(saveTimer); saveTimer = 0;
      paint();
      root.appendChild(h('div.pz-ck__card', h('div', h('b', { text: 'Signal locked!' }),
        h('span', { text: `You collected ${fmt(S.lifetime)} Static in ${mins} of play${S.reboots ? `, with ${S.reboots} reboot${S.reboots > 1 ? 's' : ''}` : ''}. That is the whole game. Play again for a fresh start.` }))));
      say(`Signal locked after ${mins}.`);
      snd.blip(523, 0.1, 'triangle', 0.8); setTimeout(() => !dead && snd.blip(659, 0.1, 'triangle', 0.8), 110); setTimeout(() => !dead && snd.blip(784, 0.2, 'triangle', 0.8), 220);
      onScore(secs);
      onEnd({ score: secs, won: true, detail: `${S.clicks} clicks${S.reboots ? ` · ${S.reboots} reboots` : ''}` });
    }

    B.on(tune, 'click', doTune);
    genRows.forEach(r => B.on(r.b, 'click', () => buyGen(r.i)));
    qtyBtns.forEach((b, i) => B.on(b, 'click', () => { qtyI = i; paint(); persistSoon(); }));
    B.on(rebootBtn, 'click', doReboot);
    B.on(resetBtn, 'click', doReset);
    const unfocus = () => { const a = document.activeElement; if (a && a.tagName === 'BUTTON' && root.contains(a)) a.blur(); };
    B.on(window, 'keydown', e => {
      if (dead || paused || ended || !ownsKey(root, e)) return;
      const k = e.key;
      if (k === ' ' || k === 'Enter') { e.preventDefault(); unfocus(); doTune(null); }
      else if (k >= '1' && k <= String(GENS.length)) { e.preventDefault(); buyGen(Number(k) - 1); }
      else if (k === 'u' || k === 'U') {
        e.preventDefault();
        const u = L2.availableUpgrades(S).filter(x => S.static >= x.cost).sort((a, b) => a.cost - b.cost)[0];
        if (u) buyUp(u.id); else say('No upgrade you can afford yet.');
      } else if (k === 'b' || k === 'B') { e.preventDefault(); qtyI = (qtyI + 1) % QTYS.length; paint(); say(`Buying ${qty() === 'max' ? 'as many as possible' : qty()} at a time.`); }
    });

    /* ----- the clock: monotonic, so a changed system clock can't speed it up ----- */
    const loop = () => {
      if (dead || paused || ended) { lastNow = performance.now(); return; }
      const now = performance.now();
      const dt = Math.max(0, (now - lastNow) / 1000);
      lastNow = now;
      /* a long gap (the tab was asleep) is credited like time away: same cap */
      L2.tick(S, Math.min(dt, L2.OFFLINE_CAP));
      paint();
      if (S.won) win();
    };
    iv = setInterval(loop, 100);
    B.add(() => clearInterval(iv));
    const auto = setInterval(() => { if (!dead && !paused && !ended) persistNow(); }, 5000);
    B.add(() => clearInterval(auto));
    B.on(document, 'visibilitychange', () => { if (document.visibilityState === 'hidden' && !ended) persistNow(); });
    B.on(window, 'pagehide', () => { if (!ended) persistNow(); });

    paint();
    if (S.won) win(); else persistNow();

    return {
      stop() {
        if (dead) return;
        if (!ended) persistNow();
        dead = true; clearTimeout(saveTimer); clearTimeout(confirmTimer);
        B.clear(); snd.close(); root.remove();
      },
      pause() { if (dead || paused) return; paused = true; if (!ended) { persistNow(); root.appendChild(h('div.pz__cover', { text: 'Paused' })); } },
      resume() { if (dead || !paused) return; paused = false; lastNow = performance.now(); root.querySelector('.pz__cover')?.remove(); },
      peek: () => ({
        static: S.static, lifetime: S.lifetime, rate: L2.rate(S), clickValue: L2.clickValue(S), count: S.count.slice(), owned: S.owned.slice(),
        clarity: S.clarity, reboots: S.reboots, clicks: S.clicks, runSeconds: S.runSeconds, won: S.won, ended, paused, wins, qty: qty(),
        goal: GOAL, offlineCapSeconds: L2.OFFLINE_CAP, away: away ? { ...away } : null, offlineTotal: S.offlineTotal, rebootGain: L2.rebootGain(S),
        confirm, upgrades: L2.availableUpgrades(S).map(u => u.id),
      }),
      /* test hook — nothing in the game calls it: grant(n) adds Static as if earned · set(patch) */
      hook(cmd, arg) {
        if (cmd === 'grant') { S.static += arg; S.lifetime += arg; if (S.lifetime >= GOAL && !S.won) { S.lifetime = GOAL - 1; S.static = Math.min(S.static, GOAL - 1); } paint(); }
        else if (cmd === 'set') { Object.assign(S, arg); paint(); }
        return true;
      },
    };
  },
};
