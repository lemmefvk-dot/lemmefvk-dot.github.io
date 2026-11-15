/* ============================================================
   arcade/sudoku.js — Sudoku for Static Arcade.

   Easy, Medium, Hard and Expert, in Classic or Diagonal (both long
   diagonals must hold 1–9 as well). Every puzzle is dealt by
   sudokulogic.js, which only keeps a puzzle that an exhaustive search
   proves has exactly one solution, and grades it by the techniques a
   person needs (Easy: singles only; Medium: pairs or locked
   candidates; Hard: triples, X-Wing, XY-Wing or Swordfish; Expert:
   more than all of those). The number of givens is shown too, but the
   grade is the techniques, and the card says so.

   Today's puzzle: one puzzle a day, the same for everyone on that
   date (dailykit.js: the seed is the date), its level set by the
   weekday. The streak of days solved is kept on this device.

   Controls
     mouse / touch  tap a cell, then a number on the pad (or Erase);
                    with "Digit first" on, tap a number, then every
                    cell it goes in
     keyboard       arrows move · 1–9 enter · Backspace / Delete / 0
                    erase · N pencil notes · H hint · Z undo
   Pencil notes: in notes mode a number toggles a small note. Notes
   that a placed number rules out are removed from its row, column
   and box (switch off with "Clean notes"). A number that repeats in
   its row, column, box (or diagonal) turns red at once, with the
   square it clashes with: that's a rule, not the solution. "Show
   mistakes" also marks entries that don't match the solution. A hint
   fills one cell, says why it goes there (the single and any pair,
   X-Wing … that leads to it, with those squares outlined) and is
   counted; a puzzle solved with hints finishes but sets no best time.
   Undo steps back through entries, notes and erases.

   Score = seconds from the deal to the last cell, lower is better.
   The best time per difficulty (and variant) is kept on this device
   (portal.arcadePuzzles.sudoku); an unfinished puzzle is saved and
   picked up again after a reload, today's puzzle separately. The
   clock stops while paused, and the board is covered then, so a
   pause can't be used to think.

   ONLINE RACE (ctx.online.kit, the Arcade's race kit, ./race.js):
   both screens deal the same Medium classic puzzle from the room's
   seed. No level, Diagonal, Today, New, Hint or Show mistakes in a
   race, and nothing is saved (not your puzzle, bests or streak). Every
   digit typed that isn't the solution's counts as a mistake (+10 s);
   the board's progress goes to the friend's bar as it fills.
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { ownsKey, rng, randomSeed } from './kit.js';
import { CSS as BASE, load, save, fmtTime, reducedMotion, bag, clock } from './puzzlekit.js';
import { generate, hintFor, clashes, geometry, unitName, cellName, NAMES, LEVELS, TIER, VARIANTS, row, col, box, diagsOf } from './sudokulogic.js';
import * as daily from './dailykit.js';

const GAME = 'sudoku';
const LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert' };
/* today's puzzle by weekday, Sunday first: the week gets harder, Sunday is a Diagonal */
const DAILY = [['hard', 'diagonal'], ['easy', 'classic'], ['medium', 'classic'], ['medium', 'classic'], ['hard', 'classic'], ['hard', 'classic'], ['expert', 'classic']];
export const dailyFor = (day = daily.dayKey()) => {
  const [level, variant] = DAILY[daily.parseDay(day).getDay()];
  return { day, level, variant, seed: daily.daySeed(GAME, day) };
};
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const bestKey = (level, variant) => (variant === 'diagonal' ? `diagonal-${level}` : level);
const kindName = (level, variant) => (variant === 'diagonal' ? `Diagonal ${LABEL[level]}` : LABEL[level]);

const CSS = `${BASE}
.pz-sd__board{--g:1px;position:relative;width:min(100cqw,100cqh);height:min(100cqw,100cqh);display:grid;grid-template-columns:repeat(9,1fr);grid-template-rows:repeat(9,1fr);gap:var(--g);
  background:var(--line-2,rgba(255,255,255,.28));border:2px solid var(--line-2,rgba(255,255,255,.28));border-radius:8px;container-type:inline-size;outline:none;touch-action:manipulation;overflow:hidden}
.pz-sd__board:focus-visible{box-shadow:0 0 0 2px var(--ga)}
.pz-sd__c{position:relative;display:grid;place-items:center;min-width:0;min-height:0;background:var(--bg-sd,#171320);font:600 calc(100cqw / 9 * .56)/1 var(--font,system-ui);color:#9ec5ff;cursor:pointer;font-variant-numeric:tabular-nums}
.pz-sd__c.is-given{color:var(--ink-0,#fff);font-weight:800}
.pz-sd__c.bR{margin-right:2px}.pz-sd__c.bB{margin-bottom:2px}
.pz-sd__c.is-diag{background:color-mix(in srgb,#a78bfa 13%,var(--bg-sd,#171320))}
.pz-sd__c.is-peer{background:color-mix(in srgb,var(--ga) 9%,var(--bg-sd,#171320))}
.pz-sd__c.is-same{background:color-mix(in srgb,var(--ga) 24%,var(--bg-sd,#171320))}
.pz-sd__c.is-sel{background:color-mix(in srgb,var(--ga) 42%,var(--bg-sd,#171320));box-shadow:inset 0 0 0 2px var(--ga)}
.pz-sd__c.is-why{box-shadow:inset 0 0 0 2px color-mix(in srgb,#ffd166 70%,transparent)}
.pz-sd__c.is-clash{color:#ff8a8a;text-decoration:underline 2px #ff6b6b;text-underline-offset:12%}
.pz-sd__c.is-clash.is-given{color:#ffb4b4}
.pz-sd__c.is-wrong{color:#ff6b6b;background:color-mix(in srgb,#dc2626 28%,var(--bg-sd,#171320))}
.pz-sd__c.is-wrong::after{content:"";position:absolute;right:6%;top:6%;width:14%;height:14%;border-radius:50%;background:#ff6b6b}
.pz-sd__c.is-hint{box-shadow:inset 0 0 0 2px #ffd166}
.pz-sd__n{position:absolute;inset:2px;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);font:600 calc(100cqw / 9 * .22)/1 var(--font,system-ui);color:var(--ink-2,#aab);text-align:center;place-items:center}
.pz-sd__n b{font-weight:600}
.pz-sd__pad{width:min(100%,560px);display:grid;grid-template-columns:repeat(9,1fr);gap:5px;flex:0 0 auto}
.pz-sd__pad button{position:relative;padding:8px 0 10px;font:700 clamp(15px,4.2cqw,22px)/1 var(--font,system-ui);color:var(--ink-0,#fff);background:var(--fill-1,rgba(255,255,255,.07));border:1px solid var(--line-1,rgba(255,255,255,.1));border-radius:9px;cursor:pointer}
.pz-sd__pad button small{position:absolute;right:4px;bottom:2px;font:600 9px/1 var(--font,system-ui);color:var(--ink-3,#999)}
.pz-sd__pad button:disabled{opacity:.3;cursor:default}
.pz-sd__pad button[aria-pressed="true"]{background:color-mix(in srgb,var(--ga) 40%,transparent);border-color:var(--ga);box-shadow:0 0 0 1px var(--ga)}
.pz-sd__pad button:focus-visible{outline:2px solid var(--ga);outline-offset:1px}
@media (hover:hover){.pz-sd__pad button:not(:disabled):hover{background:var(--fill-2,rgba(255,255,255,.13))}}
.pz-sd__day small{display:inline-flex;align-items:center;gap:2px;font-weight:700;color:#ffb46b;margin-left:2px}
.pz-sd__day small:empty{display:none}
.pz-sd__day small .icon,.pz-sd__day small svg{width:12px;height:12px}
.pz-sd__card{position:absolute;inset:0;display:grid;place-items:center;z-index:4;background:rgba(10,8,16,.78);border-radius:8px;text-align:center;padding:16px}
.pz-sd__card div{max-width:34ch}
.pz-sd__card b{display:block;font-size:22px;margin-bottom:6px;color:#fff}
.pz-sd__card span{font-size:13px;color:var(--ink-2,#bbb);line-height:1.5}
.pz.is-reduced .pz-sd__c{transition:none}
.pz:not(.is-reduced) .pz-sd__c{transition:background .12s}
`;

export default {
  mount(el, ctx = {}) {
    const onScore = typeof ctx.onScore === 'function' ? ctx.onScore : () => {};
    const onEnd = typeof ctx.onEnd === 'function' ? ctx.onEnd : () => {};
    const reduced = reducedMotion(ctx);
    const L = bag();
    let dead = false, paused = false;
    /* an online race: the room's seed, Medium classic, nothing saved */
    const NET = ctx.online?.kit && Number.isInteger(ctx.online.seed) ? ctx.online : null;
    const saved = NET ? {} : load(GAME);
    const bests = { ...(saved.best || {}) };
    const prefs = {
      level: LEVELS.includes(saved.level) ? saved.level : 'easy', variant: VARIANTS.includes(saved.variant) ? saved.variant : 'classic',
      show: !!saved.show, clean: saved.clean !== false, digitFirst: saved.digitFirst === true,
    };
    /* G: the game on the board */
    let G = null;
    let sel = -1, notesMode = false, hintCell = -1, why = [], msg = '', brush = 0;
    const undo = [];

    /* ---------- chrome ---------- */
    const levelBtns = LEVELS.map(k => h('button', { type: 'button', dataset: { level: k }, 'aria-pressed': 'false' }, LABEL[k]));
    const seg = h('div.pz__seg', { role: 'group', 'aria-label': 'Difficulty' }, levelBtns);
    const diagBtn = h('button.pz__btn', { type: 'button', 'aria-pressed': 'false', dataset: { act: 'diagonal' }, title: 'Diagonal Sudoku: both long diagonals must hold 1–9 as well' }, h('span', { text: 'Diagonal' }));
    const dayStreak = h('small', { text: '' });
    const dayBtn = h('button.pz__btn.pz-sd__day', { type: 'button', 'aria-pressed': 'false', dataset: { act: 'daily' }, title: 'Today’s puzzle: the same one for everyone today' }, icon('calendar'), h('span', { text: 'Today' }), dayStreak);
    const timeV = h('span', { text: '0:00' });
    const timeRead = h('div.pz__read', { title: 'Time', 'aria-label': 'Time' }, icon('clock'), timeV);
    const bestV = h('small', { text: '' });
    const newBtn = h('button.pz__btn', { type: 'button', title: 'Deal a new puzzle', 'aria-label': 'New puzzle' }, icon('refresh'), h('span.pz__long', { text: 'New' }));
    const top = h('div.pz__top', seg, diagBtn, dayBtn, timeRead, bestV, newBtn);
    if (NET) for (const b of [seg, diagBtn, dayBtn, bestV, newBtn]) b.hidden = true;
    const board = h('div.pz-sd__board', { role: 'grid', tabindex: '0', 'aria-label': 'Sudoku board' });
    const cells = Array.from({ length: 81 }, (_, i) => {
      const c = h('div.pz-sd__c' + (col(i) % 3 === 2 && col(i) < 8 ? '.bR' : '') + (row(i) % 3 === 2 && row(i) < 8 ? '.bB' : ''), { role: 'gridcell', dataset: { i } });
      board.appendChild(c);
      return c;
    });
    const stage = h('div.pz__stage', board);
    const padBtns = Array.from({ length: 9 }, (_, k) => h('button', { type: 'button', dataset: { digit: k + 1 }, 'aria-label': `Enter ${k + 1}` }, String(k + 1), h('small', { text: '9' })));
    const pad = h('div.pz-sd__pad', padBtns);
    const eraseBtn = h('button.pz__btn', { type: 'button', title: 'Erase the cell (Backspace)' }, h('span', { text: 'Erase' }));
    const undoBtn = h('button.pz__btn', { type: 'button', title: 'Undo (Z)' }, icon('rotate-ccw'), h('span', { text: 'Undo' }));
    const notesBtn = h('button.pz__btn', { type: 'button', 'aria-pressed': 'false', title: 'Pencil notes (N)' }, h('span', { text: 'Notes' }));
    const firstBtn = h('button.pz__btn', { type: 'button', 'aria-pressed': 'false', dataset: { act: 'digit-first' }, title: 'Pick a number on the pad, then tap every cell it goes in' }, h('span', { text: 'Digit first' }));
    const hintBtn = h('button.pz__btn', { type: 'button', title: 'Fill one cell and say why (H). Counted, and a puzzle solved with hints sets no best time.' }, icon('sparkles'), h('span', { text: 'Hint' }), h('small', { text: '0' }));
    const fillBtn = h('button.pz__btn', { type: 'button', title: 'Pencil in every candidate that still fits' }, h('span', { text: 'Fill notes' }));
    const mistakeBtn = h('button.pz__btn', { type: 'button', 'aria-pressed': 'false', title: 'Mark entries that are wrong' }, icon('eye'), h('span.pz__long', { text: 'Show mistakes' }));
    const cleanBtn = h('button.pz__btn', { type: 'button', 'aria-pressed': 'false', title: 'Remove a placed number from the notes in its row, column and box' }, h('span', { text: 'Clean notes' }));
    const bar = h('div.pz__bar', undoBtn, eraseBtn, notesBtn, firstBtn, hintBtn, fillBtn, mistakeBtn, cleanBtn);
    if (NET) { hintBtn.hidden = true; mistakeBtn.hidden = true; }
    const showWrong = () => prefs.show && !NET;
    const foot = h('div.pz__foot');
    const live = h('div.pz__live', { 'aria-live': 'polite' });
    const root = h('div.pz' + (reduced ? '.is-reduced' : ''), { style: { '--ga': ctx.accent || 'var(--accent, #ff456d)' } },
      h('style', { text: CSS }), top, stage, pad, bar, foot, live);
    el.appendChild(root);

    const say = m => { live.textContent = ''; live.textContent = m; msg = m; paintFoot(); };
    const clk = clock(s => { timeV.textContent = fmtTime(s); });
    const paintFoot = () => {
      foot.replaceChildren(msg
        ? h('span', { text: msg })
        : h('span.pz__hint', { html: prefs.digitFirst ? `pick a number, then tap its cells · <kbd>N</kbd> notes${NET ? '' : ' · <kbd>H</kbd> hint'} · <kbd>Z</kbd> undo` : `<kbd>1</kbd>–<kbd>9</kbd> enter · <kbd>N</kbd> notes${NET ? '' : ' · <kbd>H</kbd> hint'} · <kbd>Z</kbd> undo · arrows move` }));
    };

    /* ---------- state helpers ---------- */
    const geo = () => geometry(G.variant);
    const solved = () => G.vals.every((v, i) => v === G.sol[i]);
    const snapshot = () => ({ v: G.vals.slice(), n: G.notes.slice() });
    const pushUndo = () => { undo.push(snapshot()); if (undo.length > 300) undo.shift(); };
    const record = () => ({ seed: G.seed, level: G.level, variant: G.variant, tier: G.tier, puz: G.puz.join(''), sol: G.sol.join(''), vals: G.vals.join(''), notes: G.notes.slice(), secs: Math.round(clk.secs), hints: G.hints, day: G.day || undefined });
    const persist = () => {
      if (!G || G.done || NET) return;
      /* today's puzzle keeps its own slot, so a normal deal never loses it */
      if (G.day) save(GAME, { dgame: record(), last: 'daily' });
      else save(GAME, { game: record(), last: 'normal' });
    };
    const persistPrefs = () => { if (!NET) save(GAME, { level: prefs.level, variant: prefs.variant, show: prefs.show, clean: prefs.clean, digitFirst: prefs.digitFirst }); };
    /* the race's progress: the share of the empty squares filled in (right or not — the
       bar on your own screen must not work as a check), never all of it until it's solved */
    const progress = () => {
      if (!NET || !G) return;
      let n = 0, ok = 0;
      G.puz.forEach((v, i) => { if (!v) { n++; if (G.vals[i]) ok++; } });
      NET.progress(G.done ? 1 : Math.min(0.99, n ? ok / n : 1));
    };

    function adopt(d) {
      G = {
        seed: d.seed, level: d.level, variant: VARIANTS.includes(d.variant) ? d.variant : 'classic', tier: d.tier, hints: d.hints || 0, done: !!d.done,
        puz: d.puz, sol: d.sol, givens: d.puz.filter(Boolean).length,
        vals: d.vals || d.puz.slice(), notes: d.notes || new Array(81).fill(0),
        used: d.used || {}, day: d.day || '', err: 0,
      };
      undo.length = 0; sel = -1; hintCell = -1; why = []; notesMode = false; msg = '';
      if (!G.day) { prefs.level = d.level; prefs.variant = G.variant; }
      brush = 0;
      clk.secs = d.secs || 0;
      timeV.textContent = fmtTime(clk.secs);
      paused = false;
      stage.querySelector('.pz__cover')?.remove();
      stage.querySelector('.pz-sd__card')?.remove();
      if (G.done) clk.stop(); else clk.start();
      render();
      persistPrefs();
      persist();
    }
    const parse = s => [...s].map(Number);
    const fromRecord = g0 => (g0 && typeof g0.puz === 'string' && g0.puz.length === 81 && typeof g0.sol === 'string' && g0.sol.length === 81 && LEVELS.includes(g0.level)
      ? { seed: g0.seed, level: g0.level, variant: g0.variant, tier: g0.tier, puz: parse(g0.puz), sol: parse(g0.sol), vals: parse(String(g0.vals || g0.puz)).slice(0, 81), notes: Array.isArray(g0.notes) && g0.notes.length === 81 ? g0.notes.map(n => n | 0) : null, secs: g0.secs, hints: g0.hints, day: g0.day }
      : null);
    const dealt = (seed, level, variant) => generate(seed, level, rng(seed ^ (TIER[level] * 0x9e3779b1) ^ (variant === 'diagonal' ? 0x5bd1e995 : 0)), { variant });
    function deal(level, seed = randomSeed(), variant = prefs.variant) {
      const r = dealt(seed, level, variant);
      adopt({ seed, level, variant, tier: r.tier, puz: r.puzzle, sol: r.solution, used: r.used });
      const honest = r.tier === TIER[level] ? '' : ` (the closest to ${LABEL[level]} this deal could find)`;
      say(`${variant === 'diagonal' ? 'Diagonal: ' : ''}${NAMES[r.tier] || LABEL[level]} puzzle, ${G.givens} givens${honest}.`);
    }
    /* today's puzzle: carry on with it, or deal it from the date */
    function playDaily(day = daily.dayKey()) {
      const D = dailyFor(day);
      const mine = fromRecord(load(GAME).dgame);
      const st = daily.status(GAME, day);
      if (mine && mine.day === day && !st.solved) {
        adopt(mine);
        say(`Today’s puzzle, where you left it: ${daily.weekday(day)}’s is ${kindName(D.level, D.variant)}.`);
        return;
      }
      const r = dealt(D.seed, D.level, D.variant);
      adopt({ seed: D.seed, level: D.level, variant: D.variant, tier: r.tier, puz: r.puzzle, sol: r.solution, used: r.used, day,
        ...(st.solved ? { done: true, vals: r.solution.slice(), secs: st.secs, hints: st.hints } : {}) });
      if (st.solved) {
        say(`You solved today’s puzzle in ${fmtTime(st.secs)}. A new one comes at midnight.`);
      } else say(`Today’s puzzle (${daily.weekday(day)}): ${kindName(D.level, D.variant)}, ${G.givens} givens — the same for everyone today.`);
    }

    /* ---------- render ---------- */
    function counts() {
      const c = new Array(10).fill(0);
      G.vals.forEach((v, i) => { if (v && v === G.sol[i]) c[v]++; });
      return c;
    }
    function render() {
      if (!G) return;
      const sv = sel >= 0 ? G.vals[sel] : 0, hi = brush || sv;
      const P = geo().peers, diag = G.variant === 'diagonal';
      const peerSet = sel >= 0 ? new Set(P[sel]) : null;
      const clash = clashes(G.vals, G.variant);
      const whySet = new Set(why);
      cells.forEach((c, i) => {
        const v = G.vals[i], given = !!G.puz[i];
        const wrong = showWrong() && v && !given && v !== G.sol[i];
        const peer = peerSet && peerSet.has(i);
        c.className = 'pz-sd__c' + (col(i) % 3 === 2 && col(i) < 8 ? ' bR' : '') + (row(i) % 3 === 2 && row(i) < 8 ? ' bB' : '')
          + (diag && diagsOf(i).length ? ' is-diag' : '')
          + (given ? ' is-given' : '') + (i === sel ? ' is-sel' : peer ? ' is-peer' : '')
          + (hi && v === hi && i !== sel ? ' is-same' : '') + (clash.has(i) ? ' is-clash' : '') + (wrong ? ' is-wrong' : '')
          + (i === hintCell ? ' is-hint' : whySet.has(i) ? ' is-why' : '');
        const m = G.notes[i];
        if (v) { if (c.dataset.k !== 'v' + v) { c.replaceChildren(String(v)); c.dataset.k = 'v' + v; } }
        else if (m) {
          if (c.dataset.k !== 'n' + m) {
            c.replaceChildren(h('div.pz-sd__n', Array.from({ length: 9 }, (_, d) => h('b', { text: m & (1 << d) ? String(d + 1) : '' }))));
            c.dataset.k = 'n' + m;
          }
        } else if (c.dataset.k) { c.replaceChildren(); c.dataset.k = ''; }
        c.setAttribute('aria-label', `Row ${row(i) + 1}, column ${col(i) + 1}, ${v ? v + (given ? ', given' : '') : m ? 'notes' : 'empty'}${clash.has(i) ? ', repeats a number' : ''}${wrong ? ', wrong' : ''}`);
        if (i === sel) c.setAttribute('aria-selected', 'true'); else c.removeAttribute('aria-selected');
      });
      const left = counts();
      padBtns.forEach((b, k) => {
        const r = 9 - left[k + 1];
        b.lastChild.textContent = String(Math.max(0, r)); b.disabled = (r <= 0 && brush !== k + 1) || G.done;
        if (prefs.digitFirst) b.setAttribute('aria-pressed', String(brush === k + 1)); else b.removeAttribute('aria-pressed');
      });
      levelBtns.forEach(b => b.setAttribute('aria-pressed', String(!G.day && b.dataset.level === G.level)));
      diagBtn.setAttribute('aria-pressed', String(G.day ? false : G.variant === 'diagonal'));
      const st = daily.status(GAME);
      dayBtn.setAttribute('aria-pressed', String(!!G.day));
      const sk = st.streak ? `s${st.streak}` : st.solved ? 'ok' : '';
      if (dayStreak.dataset.k !== sk) {
        dayStreak.dataset.k = sk;
        dayStreak.replaceChildren(...(st.streak ? [icon('flame'), String(st.streak)] : st.solved ? [icon('check')] : []));
      }
      dayBtn.title = `Today’s puzzle: the same one for everyone today${st.solved ? ' · solved' : ''}${st.streak ? ` · ${st.streak}-day streak on this device` : ''}${st.best ? ` · best streak ${st.best}` : ''}`;
      notesBtn.setAttribute('aria-pressed', String(notesMode));
      firstBtn.setAttribute('aria-pressed', String(prefs.digitFirst));
      mistakeBtn.setAttribute('aria-pressed', String(prefs.show));
      cleanBtn.setAttribute('aria-pressed', String(prefs.clean));
      hintBtn.lastChild.textContent = String(G.hints);
      undoBtn.disabled = !undo.length || G.done;
      const bk = bestKey(G.level, G.variant), kn = kindName(G.level, G.variant);
      bestV.textContent = G.day ? `${daily.weekday(G.day)}: ${kn}` : bests[bk] != null ? `Best ${kn}: ${fmtTime(bests[bk])}` : `No ${kn} time yet`;
      paintFoot();
    }

    /* ---------- moves ---------- */
    const editable = i => i >= 0 && !G.done && !paused && !G.puz[i];
    /* "That 5 is already in row 3." — the first unit a new number repeats in */
    function clashText(i, d) {
      const g = geo();
      for (const u of g.unitsOf[i]) if (g.units[u].some(j => j !== i && G.vals[j] === d)) return `That ${d} is already in ${u < 9 ? 'this row' : u < 18 ? 'this column' : u < 27 ? 'this box' : 'this diagonal'}.`;
      return '';
    }
    function setValue(i, d) {
      if (!editable(i)) return;
      pushUndo();
      G.vals[i] = G.vals[i] === d ? 0 : d;
      G.notes[i] = 0;
      /* a race counts every wrong digit typed, even one put right later */
      if (NET && G.vals[i] && G.vals[i] !== G.sol[i]) G.err++;
      if (G.vals[i] && prefs.clean) for (const p of geo().peers[i]) G.notes[p] &= ~(1 << (d - 1));
      hintCell = -1; why = []; msg = '';
      if (G.vals[i]) { const t = clashText(i, d); if (t) msg = t; }
      afterChange();
    }
    function toggleNote(i, d) {
      if (!editable(i) || G.vals[i]) return;
      pushUndo();
      G.notes[i] ^= 1 << (d - 1);
      hintCell = -1; why = []; msg = '';
      afterChange();
    }
    function erase(i) {
      if (!editable(i) || (!G.vals[i] && !G.notes[i])) return;
      pushUndo();
      G.vals[i] = 0; G.notes[i] = 0; hintCell = -1; why = []; msg = '';
      afterChange();
    }
    function enter(d) {
      if (sel < 0) { sel = G.vals.findIndex((v, i) => !G.puz[i] && !v); if (sel < 0) return; }
      if (notesMode) toggleNote(sel, d); else setValue(sel, d);
    }
    /* Digit first: the pad picks the number, a tap puts it in */
    function pickBrush(d) {
      brush = brush === d ? 0 : d;
      msg = brush ? `${brush}: tap the cells it goes in${notesMode ? ' (as a note)' : ''}. Tap ${brush} again to put it down.` : '';
      render();
    }
    function paint(i) {
      if (!brush || G.done || paused) return false;
      if (G.puz[i]) { brush = G.puz[i]; msg = `${brush}: tap the cells it goes in.`; render(); return true; }
      if (notesMode) toggleNote(i, brush); else setValue(i, brush);
      return true;
    }
    function afterChange() {
      render();
      persist();
      progress();
      if (G.vals.every(Boolean)) {
        if (solved()) win();
        else say(showWrong() ? 'The board is full, but the red cells are wrong.' : clashes(G.vals, G.variant).size ? 'The board is full, but some numbers repeat (underlined in red).' : 'The board is full, but something is not right. Try "Show mistakes".');
      } else if (msg) say(msg);
    }
    function doUndo() {
      if (!undo.length || G.done || paused) return;
      const s = undo.pop();
      G.vals = s.v; G.notes = s.n; hintCell = -1; why = []; msg = '';
      render(); persist(); progress();
    }
    function hint() {
      if (G.done || paused || NET) return;
      const good = G.vals.map((v, i) => (v && v === G.sol[i] ? v : 0));
      const bad = i2 => !G.puz[i2] && G.vals[i2] !== G.sol[i2];
      let i, d, H = null;
      if (sel >= 0 && bad(sel)) {
        i = sel; d = G.sol[i];
        H = hintFor(good, G.variant, i);
      } else {
        H = hintFor(good, G.variant, -1);
        if (H) { i = H.i; d = H.d; } else { i = G.vals.findIndex((v, k) => bad(k)); if (i < 0) return; d = G.sol[i]; }
      }
      if (H && (H.i !== i || H.d !== d)) H = null;
      pushUndo();
      const was = G.vals[i];
      G.vals[i] = d; G.notes[i] = 0; G.hints++; sel = i; hintCell = i;
      if (prefs.clean) for (const p of geo().peers[i]) G.notes[p] &= ~(1 << (d - 1));
      why = H ? [...new Set([...(H.pattern || []), ...H.cells])].filter(k => k !== i) : [];
      let text = `Hint ${G.hints}: ${cellName(i)} is ${d}${was && was !== d ? ` (not ${was})` : ''}`;
      if (H) {
        const where = H.unit >= 0 ? ` (${unitName(H.unit)})` : '';
        const first = [];
        /* the elimination that made the single appear (outlined on the board), after any before it */
        const n = H.steps.length, last = H.steps[n - 1];
        if (n) first.push(`${n > 1 ? `After ${n - 1} earlier step${n > 2 ? 's' : ''} like it: ${last.text}` : cap(last.text)}.`);
        if (H.placed) first.push(`${H.placed} other cell${H.placed === 1 ? '' : 's'} can be filled from singles first.`);
        text += first.length ? `. ${first.join(' ')} Then ${H.text}${where}.` : `: ${H.text}${where}.`;
      } else text += ': that’s the solution’s number. None of the techniques here gets further from this board; this one takes a longer chain, or trying a number to see where it leads.';
      say(text);
      afterChange();
    }
    function fillNotes() {
      if (G.done || paused) return;
      pushUndo();
      const P = geo().peers;
      G.vals.forEach((v, i) => {
        if (v) { G.notes[i] = 0; return; }
        let m = 511;
        for (const p of P[i]) if (G.vals[p]) m &= ~(1 << (G.vals[p] - 1));
        G.notes[i] = m;
      });
      render(); persist();
    }

    function win() {
      G.done = true; clk.stop();
      brush = 0; why = [];
      const secs = Math.max(1, Math.round(clk.secs));
      if (NET) {
        hintCell = -1;
        render();
        const pen = G.err ? ` · ${G.err} mistake${G.err === 1 ? '' : 's'}` : '';
        stage.appendChild(h('div.pz-sd__card', h('div', h('b', { text: 'Solved!' }), h('span', { text: `In ${fmtTime(secs)}${pen}.` }))));
        say(`Solved in ${fmtTime(secs)}${pen}.`);
        NET.progress(1);
        onScore(secs);
        onEnd({ score: secs, won: true, detail: `Race · Medium · ${G.givens} givens${pen}`, race: { done: true, ms: Math.round(clk.secs * 1000), err: G.err, p: 1 } });
        return;
      }
      const clean = G.hints === 0;
      const bk = bestKey(G.level, G.variant), kn = kindName(G.level, G.variant);
      const prev = bests[bk];
      const fresh = clean && (prev == null || secs < prev);
      if (fresh) bests[bk] = secs;
      let dayLine = '';
      if (G.day) {
        const st = daily.solved(GAME, G.day, secs, G.hints);
        save(GAME, { best: bests, dgame: null, last: 'normal' });
        dayLine = st.already ? '' : ` Today’s puzzle is done: ${st.streak === 1 ? 'a 1-day streak' : `${st.streak} days in a row`} on this device.`;
      } else save(GAME, { best: bests, game: null });
      hintCell = -1;
      render();
      stage.appendChild(h('div.pz-sd__card', h('div', h('b', { text: 'Solved!' }),
        h('span', { text: `${kn} in ${fmtTime(secs)}${G.hints ? `, ${G.hints} hint${G.hints > 1 ? 's' : ''} (no best time with hints)` : fresh ? (prev == null ? ' — your first ' : ' — a new best for ') + kn : ''}.${dayLine}` }))));
      say(`Solved in ${fmtTime(secs)}.${dayLine}`);
      onScore(secs);
      onEnd({ score: clean ? secs : null, won: true, detail: `${G.day ? 'Today’s puzzle · ' : ''}${kn} · ${G.givens} givens · ${NAMES[G.tier] || ''} techniques${G.hints ? ` · ${G.hints} hint${G.hints > 1 ? 's' : ''}` : ''}` });
    }

    /* ---------- input ---------- */
    L.on(seg, 'click', e => {
      const b = e.target.closest?.('button[data-level]');
      if (b && !dead && !NET) deal(b.dataset.level, randomSeed(), prefs.variant);
    });
    L.on(diagBtn, 'click', () => { if (dead || NET) return; prefs.variant = G.day || G.variant !== 'diagonal' ? 'diagonal' : 'classic'; deal(G.day ? prefs.level : G.level, randomSeed(), prefs.variant); });
    L.on(dayBtn, 'click', () => { if (!dead && !G.day && !NET) playDaily(); });
    L.on(newBtn, 'click', () => { if (!dead && !NET) deal(G && !G.day ? G.level : prefs.level, randomSeed(), prefs.variant); });
    L.on(board, 'pointerdown', e => {
      const c = e.target.closest?.('.pz-sd__c');
      if (!c || paused) return;
      sel = Number(c.dataset.i);
      if (prefs.digitFirst && paint(sel)) return;
      render();
    });
    L.on(pad, 'click', e => {
      const b = e.target.closest?.('button[data-digit]');
      if (!b || paused || G.done) return;
      if (prefs.digitFirst) pickBrush(Number(b.dataset.digit)); else enter(Number(b.dataset.digit));
    });
    L.on(eraseBtn, 'click', () => erase(sel));
    L.on(undoBtn, 'click', doUndo);
    L.on(notesBtn, 'click', () => { notesMode = !notesMode; render(); });
    L.on(firstBtn, 'click', () => {
      prefs.digitFirst = !prefs.digitFirst; brush = 0; persistPrefs();
      msg = prefs.digitFirst ? 'Digit first: pick a number on the pad, then tap every cell it goes in.' : '';
      render();
    });
    L.on(hintBtn, 'click', hint);
    L.on(fillBtn, 'click', fillNotes);
    L.on(mistakeBtn, 'click', () => { if (NET) return; prefs.show = !prefs.show; persistPrefs(); render(); });
    L.on(cleanBtn, 'click', () => { prefs.clean = !prefs.clean; persistPrefs(); render(); });
    const MOVE = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    L.on(window, 'keydown', e => {
      if (dead || paused || !G || !ownsKey(root, e)) return;
      const k = e.key;
      if (MOVE[k]) {
        e.preventDefault();
        if (G.done) return;
        if (sel < 0) sel = 40;
        else sel = Math.max(0, Math.min(8, row(sel) + MOVE[k][0])) * 9 + Math.max(0, Math.min(8, col(sel) + MOVE[k][1]));
        render();
      } else if (k >= '1' && k <= '9' && !e.shiftKey) {
        e.preventDefault(); if (!e.repeat) enter(Number(k));
      } else if ((k === 'Enter' || k === ' ') && prefs.digitFirst && brush && sel >= 0) {
        e.preventDefault(); paint(sel);
      } else if (k === 'Backspace' || k === 'Delete' || k === '0') {
        e.preventDefault(); erase(sel);
      } else if (k === 'n' || k === 'N') {
        e.preventDefault(); if (!e.repeat) { notesMode = !notesMode; render(); }
      } else if (k === 'h' || k === 'H') {
        e.preventDefault(); if (!e.repeat) hint();
      } else if (k === 'z' || k === 'Z' || k === 'u' || k === 'U') {
        e.preventDefault(); doUndo();
      }
    });

    /* ---------- start: pick up the saved puzzle (today's, if that was the last one), or deal one ---------- */
    const today = daily.dayKey();
    const dg = fromRecord(saved.dgame), g0 = fromRecord(saved.game);
    if (NET) {
      deal('medium', NET.seed >>> 0, 'classic');
      say(`Race: the same Medium puzzle as ${NET.peer?.name || 'your friend'}, ${G.givens} givens. Each wrong number adds 10 seconds.`);
      progress();
    } else if (saved.last === 'daily' && dg && dg.day === today && !daily.status(GAME, today).solved) {
      adopt(dg);
      say('Welcome back: today’s puzzle is where you left it.');
    } else if (g0) {
      adopt({ ...g0, day: '' });
      say('Welcome back: your puzzle is where you left it.');
    } else deal(prefs.level, randomSeed(), prefs.variant);
    requestAnimationFrame(() => { if (!dead) board.focus({ preventScroll: true }); });
    onScore(0);

    return {
      stop() {
        if (dead) return;
        persist();
        dead = true;
        clk.dispose();
        L.clear();
        root.remove();
      },
      pause() {
        if (dead || paused) return;
        paused = true; clk.stop(); persist();
        if (!G.done) stage.appendChild(h('div.pz__cover', { text: 'Paused' }));
      },
      resume() {
        if (dead || !paused) return;
        paused = false;
        stage.querySelector('.pz__cover')?.remove();
        if (!G.done) clk.start();
      },
      /* a read-only snapshot for automated play-tests */
      peek: () => G && ({
        level: G.level, variant: G.variant, tier: G.tier, tierName: NAMES[G.tier] || null, givens: G.givens, techniques: { ...G.used }, seed: G.seed, day: G.day,
        puzzle: G.puz.join(''), solution: G.sol.join(''), vals: G.vals.join(''), notes: G.notes.slice(), sel, notesMode, digitFirst: prefs.digitFirst, brush,
        hints: G.hints, done: G.done, paused, secs: clk.secs, show: prefs.show, clean: prefs.clean, best: { ...bests },
        wrong: cells.map((c, i) => (c.classList.contains('is-wrong') ? i : -1)).filter(i => i >= 0),
        clash: cells.map((c, i) => (c.classList.contains('is-clash') ? i : -1)).filter(i => i >= 0),
        why: cells.map((c, i) => (c.classList.contains('is-why') ? i : -1)).filter(i => i >= 0),
        msg, undo: undo.length, daily: daily.status(GAME),
        race: NET ? { seed: NET.seed >>> 0, puzzle: G.puz.join(''), err: G.err } : null,
      }),
      /* test hook — nothing in the game calls it:
         deal({ level, seed, variant }) · prefill(n: fill every cell but n correctly) · secs(n: set the clock)
         · vals(81 digits: the board's entries) */
      hook(cmd, arg) {
        if (cmd === 'deal') deal(arg.level || G.level, arg.seed, arg.variant || prefs.variant);
        else if (cmd === 'prefill') {
          const empties = G.vals.map((v, i) => (v ? -1 : i)).filter(i => i >= 0);
          for (const i of empties.slice(0, Math.max(0, empties.length - arg))) G.vals[i] = G.sol[i];
          render();
        } else if (cmd === 'secs') { clk.secs = arg; timeV.textContent = fmtTime(arg); }
        else if (cmd === 'vals' && typeof arg === 'string' && arg.length === 81) { G.vals = [...arg].map(Number); G.notes.fill(0); undo.length = 0; render(); }
        return true;
      },
    };
  },
};
