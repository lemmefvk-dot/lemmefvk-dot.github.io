/* ============================================================
   arcade/wordladder.js — Word Ladder for Static Arcade.

   Go from the start word to the target word, changing one letter
   at a time, every step a real word. Words are the Arcade's own
   list (data/words, see words.js): everyday and familiar words
   count, rare ones don't. Every pair is checked to have a ladder
   and its par is the shortest one (wordladder-logic.js).

   · 3, 4 or 5 letters; New pair deals another.
   · Today: one pair a day, the same for everyone (dailykit.js: the
     seed is the date), four letters. Solving it keeps a streak on
     this device; a hint is allowed in the daily and is counted.
   · Hint shows one word that is on a shortest ladder from where you
     stand; a round with a hint never sets a best.

   Type to change a letter: ← → pick the place, a letter replaces it
   (if the new word isn't a step, the row shakes and nothing changes);
   Backspace takes a step back; ? asks for a hint. Click or tap a
   letter to pick it and a row of A–Z buttons opens to replace it.
   Restart and New pair are buttons. Score = steps, lower is better.
   The length you chose is kept on this device
   (portal.arcadePuzzles.wordladder).
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { ownsKey, sounder, randomSeed } from './kit.js';
import { CSS as BASE, load, save, reducedMotion, bag, clock, fmtTime } from './puzzlekit.js';
import { NG_CSS, resultCard, cardButton } from './ng1kit.js';
import { loadWords } from './words.js';
import * as daily from './dailykit.js';
import { LENGTHS, DAILY_LENGTH, ladder, shortest, isStep, makePair, dailyPair } from './wordladder-logic.js';

const GAME = 'wordladder';
const CSS = `${BASE}${NG_CSS}
.wl__stage{position:relative;flex:1 1 auto;min-height:0;width:100%;overflow:auto;display:flex;flex-direction:column;align-items:center;gap:6px;padding:6px 0}
.wl__row{display:flex;gap:6px;align-items:center;justify-content:center}
.wl__row i{font:600 11px/1 var(--font,system-ui);color:var(--ink-3,#999);width:26px;text-align:right;font-style:normal}
.wl__t{width:var(--wl,44px);height:var(--wl,44px);display:grid;place-items:center;border-radius:9px;background:rgba(255,255,255,.08);color:#eef1f7;font:800 calc(var(--wl,44px)*.5)/1 var(--font,system-ui);text-transform:uppercase;border:2px solid transparent;padding:0}
.wl__row--from .wl__t,.wl__row--to .wl__t{background:color-mix(in srgb,var(--ga) 26%,transparent)}
.wl__row--to .wl__t.is-ok{background:#2fd36b;color:#06210f}
.wl__row .wl__t.is-changed{background:hsla(48,100%,55%,.9);color:#2a1f00}
.wl__row--cur .wl__t{cursor:pointer;border-color:var(--line-2,rgba(255,255,255,.22));background:rgba(255,255,255,.14)}
.wl__row--cur .wl__t.is-sel{border-color:var(--ga);box-shadow:0 0 0 2px color-mix(in srgb,var(--ga) 50%,transparent)}
.wl__row--cur .wl__t:focus-visible{outline:2px solid var(--ga)}
.wl__row--gap{color:var(--ink-3,#999);font-size:12px}
.wl__pick{display:flex;flex-wrap:wrap;gap:4px;justify-content:center;max-width:min(100%,460px);flex:0 0 auto}
.wl__pick button{width:34px;height:34px;border-radius:8px;border:1px solid var(--line-1,rgba(255,255,255,.12));background:var(--fill-1,rgba(255,255,255,.06));color:var(--ink-0,#fff);font:700 14px/1 var(--font,system-ui);text-transform:uppercase;cursor:pointer;padding:0}
.wl__pick button:focus-visible{outline:2px solid var(--ga)}
.wl__hint{padding:6px 12px;border-radius:9px;background:color-mix(in srgb,#ffd23f 20%,transparent);color:#ffe28a;font-size:13px;font-weight:600}
.pz.is-big .wl__t{--wl:54px}
.pz.is-big .wl__pick button{width:40px;height:40px;font-size:16px}
`;
const ABC = 'abcdefghijklmnopqrstuvwxyz';

export default {
  mount(el, ctx = {}) {
    const onScore = typeof ctx.onScore === 'function' ? ctx.onScore : () => {};
    const onEnd = typeof ctx.onEnd === 'function' ? ctx.onEnd : () => {};
    const reduced = reducedMotion(ctx);
    const L = bag();
    const snd = sounder(ctx);
    let dead = false, paused = false;
    const sv = load(GAME);
    let len = LENGTHS.includes(Number(sv.len)) ? Number(sv.len) : 4;
    let lex = null, G = null;                  /* the list; the graph of this length */
    let pair = null, steps = [], pos = 0, done = false, hints = 0, hint = '', msg = '', dayKey = null, started = false;
    const clk = clock(t => { timeV.textContent = fmtTime(t); });
    const timeV = h('span', { text: '0:00' });
    const timeRead = h('div.pz__read', { title: 'Time', 'aria-label': 'Time' }, icon('clock'), timeV);
    const stepsV = h('span', { text: '0' });
    const stepsRead = h('div.pz__read', { title: 'Steps (par: the shortest ladder)', 'aria-label': 'Steps' }, icon('activity'), stepsV, h('small', { text: '' }));
    const lenBtns = LENGTHS.map(n => h('button', { type: 'button', dataset: { len: n }, 'aria-pressed': 'false', title: `${n}-letter words`, text: `${n}` }));
    const seg = h('div.pz__seg', { role: 'group', 'aria-label': 'Word length' }, ...lenBtns);
    const newBtn = h('button.pz__btn', { type: 'button', dataset: { act: 'new' }, title: 'A new pair' }, icon('shuffle'), h('span.pz__long', { text: 'New pair' }));
    const dayBtn = h('button.pz__btn', { type: 'button', dataset: { act: 'daily' }, title: 'Today’s pair, the same for everyone' }, icon('calendar'), h('span', { text: 'Today' }), h('small', { text: '' }));
    const hintBtn = h('button.pz__btn', { type: 'button', dataset: { act: 'hint' }, title: 'Show one word on a shortest ladder (?)' }, icon('help-circle'), h('span.pz__long', { text: 'Hint' }));
    const undoBtn = h('button.pz__btn', { type: 'button', dataset: { act: 'undo' }, title: 'Step back (Backspace)' }, icon('corner-up-left'), h('span.pz__long', { text: 'Back' }));
    const resetBtn = h('button.pz__btn', { type: 'button', dataset: { act: 'restart' }, title: 'Start this pair again' }, icon('refresh'), h('span.pz__long', { text: 'Restart' }));
    const top = h('div.pz__top', seg, newBtn, dayBtn, stepsRead, timeRead, hintBtn, undoBtn, resetBtn);
    const stage = h('div.wl__stage', { role: 'group', 'aria-label': 'Word ladder' });
    const pick = h('div.wl__pick', { hidden: true, role: 'group', 'aria-label': 'Letters' });
    const bw = h('div.ng__bw', stage);
    const foot = h('div.pz__foot');
    const live = h('div.pz__live', { 'aria-live': 'polite' });
    const root = h('div.pz' + (reduced ? '.is-reduced' : ''), { style: { '--ga': ctx.accent || 'var(--accent, #ff456d)' } }, h('style', { text: CSS }), top, bw, pick, foot, live);
    el.appendChild(root);
    const say = m => { msg = m; live.textContent = ''; live.textContent = m; paintFoot(); };
    const paintFoot = () => foot.replaceChildren(msg ? h('span', { text: msg })
      : h('span.pz__hint', { html: 'type a letter to change the picked place · <kbd>←</kbd><kbd>→</kbd> pick the place · <kbd>Backspace</kbd> back · <kbd>?</kbd> hint' }));

    const cur = () => steps[steps.length - 1] || '';
    const par = () => pair?.par || 0;
    for (const letter of ABC) pick.appendChild(h('button', { type: 'button', dataset: { letter }, 'aria-label': `Change to ${letter}`, text: letter, onclick: () => tryLetter(letter) }));

    function paint() {
      stage.replaceChildren();
      if (!pair) { stage.appendChild(h('div.wl__hint', { text: lex ? 'No pair could be dealt.' : 'Loading the word list…' })); return; }
      root.classList.toggle('is-big', !!ctx.bigText);
      const row = (word, cls, label, prev) => h(`div.wl__row.wl__row--${cls}`, h('i', { text: label }), ...[...word].map((c, i) => {
        const b = h('button.wl__t' + (prev && prev[i] !== c ? '.is-changed' : ''), { type: 'button', dataset: { i }, 'aria-label': `${c.toUpperCase()}, place ${i + 1}`, text: c });
        if (cls === 'cur') { b.tabIndex = i === pos ? 0 : -1; if (i === pos && !done) b.classList.add('is-sel'); b.addEventListener('click', () => { pos = i; kbdPick = true; paint(); }); }
        else b.tabIndex = -1;
        if (cls === 'to' && done) b.classList.add('is-ok');
        return b;
      }));
      stage.appendChild(row(pair.from, 'from', 'start'));
      for (let k = 1; k < steps.length - (done ? 0 : 1); k++) stage.appendChild(row(steps[k], 'step', `${k}`, steps[k - 1]));
      if (!done) stage.appendChild(row(cur(), 'cur', steps.length === 1 ? 'you' : `${steps.length - 1}`, steps.length > 1 ? steps[steps.length - 2] : null));
      stage.appendChild(h('div.wl__row.wl__row--gap', { text: done ? '' : '↓ one letter at a time ↓' }));
      stage.appendChild(row(pair.to, 'to', 'goal'));
      if (hint) stage.appendChild(h('div.wl__hint', { text: hint }));
      const n = steps.length - 1;
      stepsV.textContent = String(n);
      stepsRead.lastChild.textContent = `par ${par()}`;
      stepsRead.classList.toggle('is-over', n > par());
      pick.hidden = done || !kbdPick;
      lenBtns.forEach(b => b.setAttribute('aria-pressed', String(!dayKey && Number(b.dataset.len) === len)));
      const st = daily.status(GAME);
      dayBtn.lastChild.textContent = st.solved ? '✓' : st.streak ? `${st.streak}🔥` : '';
      dayBtn.setAttribute('aria-pressed', String(!!dayKey));
      undoBtn.disabled = done || steps.length < 2;
      hintBtn.disabled = done;
      stage.setAttribute('aria-label', `Word ladder from ${pair.from} to ${pair.to}. You are on ${cur()}, ${n} steps so far, par ${par()}.`);
    }
    let kbdPick = false;

    function deal(p, isDaily) {
      pair = p; steps = p ? [p.from] : []; pos = 0; done = false; hints = 0; hint = ''; started = false; paused = false;
      kbdPick = false; clk.stop(); clk.secs = 0; timeV.textContent = '0:00';
      bw.querySelector('.ng__card')?.remove(); bw.querySelector('.pz__cover')?.remove();
      paint();
      if (p) say(`${isDaily ? `Today’s pair (${daily.weekday()})` : 'A new pair'}: ${p.from} to ${p.to}. The shortest ladder is ${p.par} steps.`);
      onScore(0);
    }
    function dealNew() {
      if (!lex) return;
      dayKey = null;
      deal(makePair(lex, len, randomSeed()), false);
    }
    function dealDaily() {
      if (!lex) return;
      dayKey = daily.dayKey();
      const p = dailyPair(lex, daily.daySeed(GAME, dayKey));
      deal(p, true);
    }
    function setLen(n) { len = n; save(GAME, { len }); G = lex ? ladder(lex, len) : null; dealNew(); }

    function shake() { stage.querySelector('.wl__row--cur')?.classList.remove('is-shake'); void stage.offsetWidth; stage.querySelector('.wl__row--cur')?.classList.add('is-shake'); }
    function tryLetter(letter) {
      if (dead || paused || done || !pair || !G) return false;
      letter = String(letter).toLowerCase();
      const c = cur();
      if (!/^[a-z]$/.test(letter)) return false;
      if (c[pos] === letter) return false;
      const w = c.slice(0, pos) + letter + c.slice(pos + 1);
      snd.wake();
      if (!isStep(G, c, w)) {
        snd.blip(150, 0.07, 'sawtooth', 0.4);
        shake();
        say(`${w.toUpperCase()} isn’t on the word list.`);
        return false;
      }
      if (!started) { started = true; clk.start(); }
      steps.push(w); hint = '';
      snd.blip(420 + steps.length * 30, 0.06, 'triangle', 0.6);
      paint();
      say(`${w}. ${steps.length - 1} step${steps.length === 2 ? '' : 's'} so far.`);
      onScore(steps.length - 1);
      if (w === pair.to) win();
      return true;
    }
    function back() {
      if (dead || paused || done || steps.length < 2) return;
      steps.pop(); hint = ''; paint(); say(`Back to ${cur()}.`); onScore(steps.length - 1);
    }
    function showHint() {
      if (dead || paused || done || !pair || !G) return;
      const p = shortest(G, cur(), pair.to);
      if (!p || p.length < 2) { say('No ladder from here: go back a step.'); return; }
      hints++; hint = `Try ${p[1].toUpperCase()}${p.length - 1 > 1 ? ` — then ${p.length - 2} more` : ' — that is the goal'}.`;
      paint(); say(hint);
    }
    function win() {
      done = true; clk.stop(); hint = '';
      const n = steps.length - 1, secs = clk.secs, perfect = n <= par();
      paint();
      let extra = '';
      if (dayKey) {
        const r = daily.solved(GAME, dayKey, secs, hints);
        extra = r.streak > 1 ? ` Daily streak: ${r.streak} days.` : ' Daily solved.';
        dayBtn.lastChild.textContent = '✓';
      }
      const line = perfect ? `Perfect: ${n} steps, the shortest ladder.` : `${n} steps; the shortest ladder is ${par()}.`;
      bw.appendChild(resultCard(perfect ? 'Top of the ladder, in par!' : 'You made it!', `${pair.from} to ${pair.to} in ${fmtTime(secs)}. ${line}${hints ? ` (${hints} hint${hints === 1 ? '' : 's'} used.)` : ''}${extra}`,
        cardButton(dayKey ? 'A random pair' : 'New pair', () => dealNew(), 'shuffle')));
      say(`Solved in ${n} steps. ${line}${extra}`);
      snd.blip(523, 0.1, 'triangle', 0.8); setTimeout(() => !dead && snd.blip(784, 0.16, 'triangle', 0.8), 120);
      onScore(n);
      onEnd({ score: n, won: true, detail: `${pair.from} → ${pair.to} · ${n} steps, par ${par()}${perfect ? ' (perfect)' : ''}${dayKey ? ' · daily' : ''}`, ...(hints ? { assisted: 'A round with a hint doesn’t set a best' } : {}) });
    }

    /* ------------------------------ input ------------------------------ */
    L.on(window, 'keydown', e => {
      if (dead || paused || !ownsKey(root, e) || !pair) return;
      const k = e.key;
      if (k === 'ArrowLeft' || k === 'ArrowRight') {
        e.preventDefault();
        pos = (pos + (k === 'ArrowLeft' ? len - 1 : 1)) % len;
        paint();
        stage.querySelector('.wl__row--cur .wl__t.is-sel')?.focus?.({ preventScroll: true });
      } else if (k === 'Backspace' || k === 'Delete') { e.preventDefault(); back(); }
      else if (k === '?' || k === '/') { e.preventDefault(); showHint(); }
      else if (/^[a-zA-Z]$/.test(k)) { e.preventDefault(); tryLetter(k); }
    });
    lenBtns.forEach(b => L.on(b, 'click', () => { if (!dead) setLen(Number(b.dataset.len)); }));
    L.on(newBtn, 'click', () => { if (!dead) dealNew(); });
    L.on(dayBtn, 'click', () => { if (!dead) dealDaily(); });
    L.on(hintBtn, 'click', () => { if (!dead) showHint(); });
    L.on(undoBtn, 'click', () => { if (!dead) back(); });
    L.on(resetBtn, 'click', () => { if (!dead && pair) deal(pair, !!dayKey); });

    paint();
    say('Loading the word list…');
    const loadIt = () => loadWords().then(l => {
      if (dead) return;
      lex = l; G = ladder(lex, len);
      dealNew();
    }).catch(() => {
      if (dead) return;
      stage.replaceChildren(h('div.wl__hint', { text: 'The word list couldn’t be loaded. It needs the network the first time; after that a copy is kept.' }),
        h('button.pz__btn', { type: 'button', dataset: { act: 'retry' }, onclick: () => { stage.replaceChildren(h('div.wl__hint', { text: 'Loading the word list…' })); loadIt(); } }, icon('refresh'), h('span', { text: 'Try again' })));
      say('The word list couldn’t be loaded.');
    });
    loadIt();

    return {
      stop() { if (dead) return; dead = true; clk.dispose(); L.clear(); snd.close(); root.remove(); },
      pause() { if (dead || paused) return; paused = true; clk.stop(); if (!done && pair) bw.appendChild(h('div.pz__cover', { text: 'Paused' })); },
      resume() { if (dead || !paused) return; paused = false; bw.querySelector('.pz__cover')?.remove(); if (started && !done) clk.start(); },
      peek: () => ({
        ready: !!pair, len, from: pair?.from || '', to: pair?.to || '', par: par(), steps: steps.slice(), cur: cur(), pos, done, hints, hint, paused, daily: !!dayKey, day: dayKey,
        stats: daily.status(GAME), seconds: clk.secs, running: clk.running, message: msg, pickerOpen: !pick.hidden,
      }),
      /* test hook — nothing in the game calls it: pair(from, to) deals that pair, daily(day) deals the pair of a given day */
      hook(cmd, a, b) {
        if (!lex) return false;
        if (cmd === 'pair') { const path = shortest(ladder(lex, a.length), a, b); if (!path) return false; len = a.length; G = ladder(lex, len); dayKey = null; deal({ from: a, to: b, par: path.length - 1, path }, false); return true; }
        if (cmd === 'daily') { dayKey = a; deal(dailyPair(lex, daily.daySeed(GAME, a)), true); len = DAILY_LENGTH; G = ladder(lex, len); return true; }
        return false;
      },
    };
  },
};
