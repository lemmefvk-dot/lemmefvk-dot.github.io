/* ============================================================
   arcade/mines.js — Mines: clear the field without a bang.

   Beginner is 9×9 with 10 mines; Expert-lite is 16×16 with 40;
   Custom is any board from 5×5 to 30×24 with as many mines as leave
   the first click's square of nine clear. The choice is remembered
   (portal.arcadeMines) so "play again" keeps it. A custom board keeps
   its own best time per size and mine count, and doesn't change the
   Arcade's best (a board with one mine would win every time).

   The first cell you open is always safe: mines are only laid after
   that click, and never on it or its eight neighbours (unless the
   board is too full for that, when only the cell itself is spared).
   Empty areas open themselves; clicking an opened number whose flags
   are all placed opens the rest of its neighbours ("chording").

   Flags: right-click, long-press on touch, the F key (on the cell
   under the mouse, or the focused cell), or the Flag toggle, which
   turns every tap into a flag for touch screens. Cells are real
   buttons with a roving tab stop, so the whole board is playable
   from the keyboard: arrows move, Enter/Space opens, F flags. With
   the controller bridge on (core/padmap.js) the D-pad moves, A opens
   and the pad's X button flags; the hint says so only while a pad is
   actually connected.

   Score = seconds from the first opened cell to the last, to 0.1 s,
   lower is better. Hitting a mine ends the round with won:false (the
   time is still reported, and the result says it was a loss). While
   paused the board is covered, so a pause can't be used to think.

   ONLINE RACE (ctx.online.kit, ./race.js): Beginner, with the mines
   laid from the room's seed around a safe square picked by the same
   seed, which is opened for both players at the start — the same
   field and the same first move on both screens, and the clock runs
   from there. No board sizes or New in a race, and nothing is saved.
   The share of safe squares opened goes to the friend's bar; a bang
   ends your race with that share.
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { store } from '../core/store.js';
import * as padmap from '../core/padmap.js';
import { rng } from './kit.js';

const MODES = {
  easy: { cols: 9, rows: 9, mines: 10, name: 'Beginner', short: '9×9' },
  expert: { cols: 16, rows: 16, mines: 40, name: 'Expert-lite', short: '16×16' },
};
const PREF = 'portal.arcadeMines';
const LONG_PRESS = 420;
/* a custom board's limits: the first click and its eight neighbours always stay clear */
export const CUSTOM = { cols: [5, 30], rows: [5, 24], minMines: 1 };
export const maxMines = (cols, rows) => cols * rows - 9;
/** a custom board from what was typed: { cols, rows, mines, fixed: [what was changed] } */
export function customBoard(cols, rows, mines) {
  const fixed = [];
  const clampInt = (v, lo, hi, name) => { const n = Math.round(Number(v)); const out = Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo; if (out !== Number(v)) fixed.push(name); return out; };
  const c = clampInt(cols, ...CUSTOM.cols, 'columns'), r = clampInt(rows, ...CUSTOM.rows, 'rows');
  const m = clampInt(mines, CUSTOM.minMines, maxMines(c, r), 'mines');
  return { cols: c, rows: r, mines: m, fixed };
}
const customMode = b => ({ cols: b.cols, rows: b.rows, mines: b.mines, name: 'Custom', short: `${b.cols}×${b.rows}`, custom: true });

const FLAG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6.5 21V3.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M7.5 4h10.5l-2.6 4.2L18 12.4H7.5z" fill="currentColor"/></svg>';
const MINE = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4M5.3 5.3l2.8 2.8M15.9 15.9l2.8 2.8M5.3 18.7l2.8-2.8M15.9 8.1l2.8-2.8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="6" fill="currentColor"/><circle cx="10" cy="10" r="1.7" fill="#fff" opacity=".75"/></svg>';

const CSS = `
.arx-mn{position:relative;width:100%;height:100%;min-height:360px;display:flex;flex-direction:column;align-items:center;gap:var(--sp-3,8px);padding:var(--sp-5,16px);
  box-sizing:border-box;font-family:var(--font,system-ui);color:var(--ink-1,#eee);container-type:size;user-select:none;-webkit-user-select:none}
.arx-mn *{box-sizing:border-box}
.arx-mn__top{width:min(100%,720px);display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:var(--sp-3,8px);flex:0 0 auto}
.arx-mn__seg{display:inline-flex;padding:3px;border-radius:var(--r-md,11px);background:var(--fill-1,rgba(255,255,255,.06));border:1px solid var(--line-0,rgba(255,255,255,.05))}
.arx-mn__seg button{font:600 var(--fs-12,12px)/1 var(--font,system-ui);color:var(--ink-2,#aaa);background:none;border:0;padding:7px 11px;border-radius:8px;cursor:pointer;white-space:nowrap}
.arx-mn__seg button[aria-pressed="true"]{background:var(--fill-3,rgba(255,255,255,.15));color:var(--ink-0,#fff);box-shadow:0 1px 2px rgba(0,0,0,.3)}
.arx-mn__seg button:focus-visible,.arx-mn__btn:focus-visible{outline:2px solid var(--ga);outline-offset:2px}
.arx-mn__seg small{font-size:inherit;color:var(--ink-3,#888);margin-left:5px;font-weight:500}
.arx-mn__seg button[aria-pressed="true"] small{color:var(--ink-2,#bbb)}
.arx-mn__grow{width:var(--sp-3,8px)}
.arx-mn__read{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:var(--r-md,11px);background:var(--fill-0,rgba(255,255,255,.03));border:1px solid var(--line-0,rgba(255,255,255,.05));
  font-size:clamp(14px,2.8cqmin,17px);font-weight:700;color:var(--ink-0,#fff);font-variant-numeric:tabular-nums;min-width:64px}
.arx-mn__read svg,.arx-mn__read .icon{width:15px;height:15px;flex:0 0 auto}
.arx-mn__read--flags svg{color:var(--ga)}
.arx-mn__read .icon{color:var(--ink-3,#888)}
.arx-mn__btn{display:inline-flex;align-items:center;gap:6px;font:600 var(--fs-12,12px)/1 var(--font,system-ui);color:var(--ink-1,#ddd);background:var(--fill-1,rgba(255,255,255,.06));
  border:1px solid var(--line-1,rgba(255,255,255,.08));padding:7px 10px;border-radius:var(--r-md,11px);cursor:pointer;white-space:nowrap}
.arx-mn__btn svg,.arx-mn__btn .icon{width:14px;height:14px}
@media (hover:hover){.arx-mn__btn:hover{background:var(--fill-2,rgba(255,255,255,.1))}}
.arx-mn__btn[aria-pressed="true"]{background:color-mix(in srgb,var(--ga) 22%,transparent);border-color:color-mix(in srgb,var(--ga) 60%,transparent);color:var(--ink-0,#fff)}
.arx-mn__btn[aria-pressed="true"] svg{color:var(--ga)}
.arx-mn__wrap{position:relative;flex:1 1 auto;min-height:220px;width:100%;container-type:size;display:grid;place-items:center}
.arx-mn__board{--n:9;--m:9;position:relative;width:min(100cqw,calc(100cqh * var(--n) / var(--m)),calc(720px * var(--n) / max(var(--n), var(--m))));aspect-ratio:var(--n) / var(--m);display:grid;
  grid-template-columns:repeat(var(--n),minmax(0,1fr));grid-template-rows:repeat(var(--m),minmax(0,1fr));gap:var(--gap,3px);padding:var(--gap,3px);border-radius:var(--r-lg,15px);
  background:var(--fill-0,rgba(255,255,255,.03));border:1px solid var(--line-1,rgba(255,255,255,.08));container-type:inline-size;touch-action:manipulation;-webkit-touch-callout:none}
.arx-mn__c{position:relative;display:grid;place-items:center;min-width:0;min-height:0;padding:0;border:0;border-radius:var(--cr,6px);cursor:pointer;
  font:800 calc(100cqw / var(--n) * .5)/1 var(--font,system-ui);font-variant-numeric:tabular-nums;color:var(--ink-1,#ddd);outline:none;-webkit-tap-highlight-color:transparent;
  background:linear-gradient(180deg,var(--fill-3,rgba(255,255,255,.15)),var(--fill-2,rgba(255,255,255,.1)));box-shadow:inset 0 1px 0 rgba(255,255,255,.09),inset 0 -1px 0 rgba(0,0,0,.25)}
@media (hover:hover){.arx-mn:not(.is-over) .arx-mn__c:not(.is-open):hover{background:linear-gradient(180deg,color-mix(in srgb,var(--ga) 30%,var(--fill-3,rgba(255,255,255,.15))),var(--fill-2,rgba(255,255,255,.1)))}}
.arx-mn__c:focus-visible{outline:none;box-shadow:0 0 0 2px var(--ink-0,#fff);z-index:1}
.arx-mn__c svg{width:62%;height:62%}
.arx-mn__c.is-flag svg{color:var(--ga)}
.arx-mn__c.is-open{background:var(--fill-0,rgba(255,255,255,.025));box-shadow:none;cursor:default}
.arx-mn__c.is-open.is-num{cursor:pointer}
.arx-mn__c[data-n="1"]{color:#60a5fa}.arx-mn__c[data-n="2"]{color:#4ade80}.arx-mn__c[data-n="3"]{color:#f87171}.arx-mn__c[data-n="4"]{color:#c084fc}
.arx-mn__c[data-n="5"]{color:#fb923c}.arx-mn__c[data-n="6"]{color:#2dd4bf}.arx-mn__c[data-n="7"]{color:#f472b6}.arx-mn__c[data-n="8"]{color:#e5e7eb}
/* deeper numbers only on a genuinely light board (the Arcade's cabinet stays dark in light mode) */
.arx-mn.is-light .arx-mn__c[data-n="1"]{color:#1d4ed8}.arx-mn.is-light .arx-mn__c[data-n="2"]{color:#15803d}
.arx-mn.is-light .arx-mn__c[data-n="3"]{color:#b91c1c}.arx-mn.is-light .arx-mn__c[data-n="4"]{color:#7e22ce}
.arx-mn.is-light .arx-mn__c[data-n="5"]{color:#c2410c}.arx-mn.is-light .arx-mn__c[data-n="6"]{color:#0f766e}
.arx-mn.is-light .arx-mn__c[data-n="7"]{color:#be185d}.arx-mn.is-light .arx-mn__c[data-n="8"]{color:#374151}
.arx-mn__c.is-mine{background:var(--fill-1,rgba(255,255,255,.06));box-shadow:none;color:var(--ink-1,#ddd);cursor:default}
.arx-mn__c.is-boom{background:#dc2626;color:#fff;box-shadow:0 0 18px -2px #dc2626;z-index:1}
.arx-mn__c.is-wrong svg{opacity:.45}
.arx-mn__c.is-wrong::after{content:"";position:absolute;left:18%;right:18%;top:50%;height:2px;background:#f87171;transform:rotate(-45deg);border-radius:2px}
.arx-mn__c.is-won{background:color-mix(in srgb,var(--ga) 18%,transparent);box-shadow:none}
.arx-mn.is-over .arx-mn__c{cursor:default}
.arx-mn:not(.is-reduced) .arx-mn__c.is-open{animation:arx-mn-open .16s ease-out}
@keyframes arx-mn-open{from{transform:scale(.86);opacity:.4}to{transform:none;opacity:1}}
.arx-mn__custom{width:min(100%,720px);display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:8px;padding:8px 10px;border-radius:var(--r-md,11px);background:var(--fill-0,rgba(255,255,255,.03));border:1px solid var(--line-1,rgba(255,255,255,.08));font-size:12px;flex:0 0 auto}
.arx-mn__custom[hidden]{display:none}
.arx-mn__custom label{display:inline-flex;align-items:center;gap:6px;color:var(--ink-2,#bbb)}
.arx-mn__custom input{width:4.2em;font:700 13px/1 var(--font,system-ui);color:var(--ink-0,#fff);background:var(--fill-1,rgba(255,255,255,.06));border:1px solid var(--line-1,rgba(255,255,255,.12));border-radius:8px;padding:6px 6px}
.arx-mn__custom input:focus-visible{outline:2px solid var(--ga);outline-offset:1px}
.arx-mn__custom small{color:var(--ink-3,#999)}
.arx-mn__cover{position:absolute;inset:0;display:grid;place-items:center;border-radius:var(--r-lg,15px);background:#120b10;font-size:clamp(20px,5cqmin,30px);font-weight:800;color:#fff;z-index:3}
.arx-mn__foot{width:min(100%,720px);min-height:34px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;gap:var(--sp-3,8px);font-size:var(--fs-12,12px);color:var(--ink-3,#888);text-align:center}
.arx-mn__foot kbd{font:600 calc(11px * var(--fs-k,1))/1 var(--mono,ui-monospace,monospace);padding:3px 6px;border-radius:5px;border:1px solid var(--line-2,rgba(255,255,255,.14));border-bottom-width:2px;background:var(--fill-1,rgba(255,255,255,.05));color:var(--ink-1,#ddd)}
.arx-mn__result{display:inline-flex;align-items:center;gap:8px;padding:7px 8px 7px 14px;border-radius:99px;font-size:var(--fs-13,13px);font-weight:600;color:var(--ink-0,#fff);
  background:color-mix(in srgb,var(--ga) 18%,transparent);border:1px solid color-mix(in srgb,var(--ga) 50%,transparent)}
.arx-mn__result.is-loss{background:color-mix(in srgb,#dc2626 16%,transparent);border-color:color-mix(in srgb,#dc2626 50%,transparent)}
.arx-mn__result b{font-variant-numeric:tabular-nums}
.arx-mn__result .icon,.arx-mn__result svg{width:15px;height:15px;flex:0 0 auto}
.arx-mn__result .icon{color:var(--ga)}
.arx-mn.is-reduced .arx-mn__c{animation:none!important}
@container (max-width:520px){.arx-mn{padding:var(--sp-3,8px);gap:6px}.arx-mn__long{display:none}.arx-mn__seg small{margin:0;color:inherit}.arx-mn__grow{display:none}.arx-mn__seg button{padding:7px 9px}.arx-mn__btn{padding:7px 8px}.arx-mn__read{min-width:0;padding:6px 8px}}
@container (max-height:470px){.arx-mn__hint{display:none}}
`;

export default {
  mount(el, ctx = {}) {
    const onScore = typeof ctx.onScore === 'function' ? ctx.onScore : () => {};
    const onEnd = typeof ctx.onEnd === 'function' ? ctx.onEnd : () => {};

    let dead = false, paused = false;
    /* an online race: Beginner, laid from the room's seed */
    const NET = ctx.online?.kit && Number.isInteger(ctx.online.seed) ? ctx.online : null;
    const raceRnd = NET ? rng((NET.seed >>> 0) ^ 0x6d1e5) : null;
    let raceSafe = -1;
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    const prefNow = () => { const p = store.get(PREF, null); return p && typeof p === 'object' ? p : {}; };
    const savedCustom = prefNow().custom;
    let custom = savedCustom ? customBoard(savedCustom.cols, savedCustom.rows, savedCustom.mines) : { cols: 12, rows: 10, mines: 20 };
    const modeOf = key => (key === 'custom' ? customMode(custom) : MODES[key]);
    let modeKey = NET ? 'easy' : MODES[store.get(`${PREF}.mode`)] || (store.get(`${PREF}.mode`) === 'custom' && savedCustom) ? store.get(`${PREF}.mode`) : 'easy';
    const customBest = { ...(prefNow().customBest || {}) };
    const customKey = b => `${b.cols}x${b.rows}x${b.mines}`;
    let M, N;                        // current mode, cell count
    let mine, adj, cell;             // Uint8Arrays; cell: 0 covered, 1 open, 2 flagged
    let laid = false, over = false, won = false;
    let opened = 0, flags = 0;
    let startAt = 0, banked = 0, ticker = 0, lastSec = -1;
    let focusIdx = 0, hoverIdx = -1, lastInput = 'pointer';
    let flagMode = false;
    let boomAt = -1;
    let lp = null;                   // long-press { timer, i, x, y }
    let skip = { i: -1, until: 0 };  // the click/contextmenu that trails a long-press on that same cell
    let buttons = [];
    const offs = [];
    const listen = (t, type, fn, opts) => { t.addEventListener(type, fn, opts); offs.push(() => t.removeEventListener(type, fn, opts)); };

    /* ---- chrome ---- */
    const modeBtns = Object.entries(MODES).map(([key, m]) =>
      h('button', { type: 'button', dataset: { mode: key }, 'aria-pressed': 'false', title: `${m.name}: ${m.short}, ${m.mines} mines` },
        h('span.arx-mn__long', { text: m.name }), h('small', { text: m.short })));
    const customShort = h('small', { text: '' });
    const customBtn = h('button', { type: 'button', dataset: { mode: 'custom' }, 'aria-pressed': 'false', title: 'Your own size and number of mines' }, h('span', { text: 'Custom' }), customShort);
    modeBtns.push(customBtn);
    const seg = h('div.arx-mn__seg', { role: 'group', 'aria-label': 'Board size' }, modeBtns);
    /* the custom board's settings */
    const num = (label, v, lo, hi) => h('input', { type: 'number', min: String(lo), max: String(hi), step: '1', value: String(v), 'aria-label': label, inputmode: 'numeric' });
    const colsIn = num('Columns', custom.cols, ...CUSTOM.cols), rowsIn = num('Rows', custom.rows, ...CUSTOM.rows), minesIn = num('Mines', custom.mines, CUSTOM.minMines, maxMines(custom.cols, custom.rows));
    const densityV = h('small', { text: '' });
    const playCustom = h('button.arx-mn__btn', { type: 'button', dataset: { act: 'play-custom' } }, icon('play'), h('span', { text: 'Play' }));
    const customBar = h('div.arx-mn__custom', { hidden: true, role: 'group', 'aria-label': 'Custom board' },
      h('label', 'Columns', colsIn), h('label', 'Rows', rowsIn), h('label', 'Mines', minesIn), densityV, playCustom);
    const vFlags = h('span', { text: '10' });
    const vTime = h('span', { text: '0' });
    const flagsRead = h('div.arx-mn__read.arx-mn__read--flags', { title: 'Mines left (mines minus flags)', 'aria-label': 'Mines left' }, h('span', { html: FLAG }), vFlags);
    const timeRead = h('div.arx-mn__read', { title: 'Seconds', 'aria-label': 'Time in seconds' }, icon('clock'), vTime);
    const flagBtn = h('button.arx-mn__btn', { type: 'button', 'aria-pressed': 'false', title: 'Flag mode: taps place flags' }, h('span', { html: FLAG }), h('span', { text: 'Flag' }));
    const newBtn = h('button.arx-mn__btn', { type: 'button', title: 'New board', 'aria-label': 'New board' }, icon('refresh'), h('span.arx-mn__long', { text: 'New' }));
    const top = h('div.arx-mn__top', seg, h('div.arx-mn__grow'), flagsRead, timeRead, flagBtn, newBtn);
    if (NET) { seg.hidden = true; newBtn.hidden = true; }
    const board = h('div.arx-mn__board', { role: 'group' });
    const wrap = h('div.arx-mn__wrap', board);
    const foot = h('div.arx-mn__foot');
    const live = h('div', { 'aria-live': 'polite', style: { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)' } });
    const reduced = !!ctx.reduced || document.body.classList.contains('reduce-motion')
      || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    const root = h('div.arx-mn' + (reduced ? '.is-reduced' : ''), { style: { '--ga': ctx.accent || 'var(--accent, #ff456d)' } },
      h('style', { text: CSS }), top, customBar, wrap, foot, live);
    el.appendChild(root);
    const paintDensity = () => {
      const b = customBoard(colsIn.value, rowsIn.value, minesIn.value);
      minesIn.max = String(maxMines(b.cols, b.rows));
      densityV.textContent = `${Math.round(100 * b.mines / (b.cols * b.rows))}% mines · up to ${maxMines(b.cols, b.rows)}`;
    };
    paintDensity();

    /* A light board gets deeper number colours. Read the ink actually in
       effect, not the OS theme: the Arcade keeps its cabinet dark (and its
       ink light) even in light mode. Re-checked when the theme changes. */
    let themeFrame = 0;
    const paintTheme = () => {
      themeFrame = 0;
      const m = getComputedStyle(root).color.match(/[\d.]+/g);
      root.classList.toggle('is-light', !!m && (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) < 128);
    };
    paintTheme();
    const offTheme = store.sub?.('prefs.theme', () => { if (!dead && !themeFrame) themeFrame = requestAnimationFrame(paintTheme); });
    if (offTheme) offs.push(offTheme, () => cancelAnimationFrame(themeFrame));

    const say = msg => { live.textContent = ''; live.textContent = msg; };
    const elapsed = () => banked + (laid && !over && !paused ? performance.now() - startAt : 0);
    const rc = i => [Math.floor(i / M.cols), i % M.cols];

    function around(i) {
      const [r, c] = rc(i);
      const out = [];
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < M.rows && cc >= 0 && cc < M.cols) out.push(rr * M.cols + cc);
      }
      return out;
    }

    /* the pad's X button flags: whatever key the bridge maps it to */
    const padFlagCode = () => { try { return padmap.getConfig().mapping.x || ''; } catch (err) { return ''; } };
    function padHint() {
      try {
        if (!padmap.isEnabled() || !padmap.connectedPads().length) return '';
        const map = padmap.getConfig().mapping;
        const opens = ['Space', 'Enter', 'NumpadEnter'].includes(map.a);
        return ['Controller: D-pad moves', opens ? 'A opens' : '', map.x ? 'X flags' : ''].filter(Boolean).join(' · ');
      } catch (err) { return ''; }
    }
    function hint() {
      if (over) return;              // the result stays until a new board
      const pad = padHint();
      foot.replaceChildren(pad
        ? h('span.arx-mn__hint', { text: pad })
        : coarse
          ? h('span.arx-mn__hint', { text: 'Long-press a cell to flag it, or switch on Flag so every tap flags' })
          : h('span.arx-mn__hint', 'Right-click or long-press to flag · ', h('kbd', { text: 'F' }), ' flags · arrows + ', h('kbd', { text: 'Enter' }), ' to play by keyboard'));
    }

    /* ---- a fresh board ---- */
    function build(key) {
      clearInterval(ticker); ticker = 0;
      modeKey = key;
      M = modeOf(key);
      N = M.cols * M.rows;
      mine = new Uint8Array(N); adj = new Uint8Array(N); cell = new Uint8Array(N);
      laid = false; over = false; won = false; opened = 0; flags = 0; boomAt = -1;
      banked = 0; lastSec = -1; focusIdx = Math.floor(N / 2); hoverIdx = -1;
      root.classList.remove('is-over');
      board.style.setProperty('--n', String(M.cols));
      board.style.setProperty('--m', String(M.rows));
      const big = Math.max(M.cols, M.rows);
      board.style.setProperty('--gap', big > 20 ? '1px' : big > 12 ? '2px' : '4px');
      board.style.setProperty('--cr', big > 20 ? '3px' : big > 12 ? '4px' : '7px');
      customShort.textContent = `${custom.cols}×${custom.rows}`;
      board.setAttribute('aria-label', `Minefield, ${M.rows} rows by ${M.cols} columns, ${M.mines} mines`);
      buttons = Array.from({ length: N }, (_, i) => h('button.arx-mn__c', { type: 'button', tabindex: i === focusIdx ? '0' : '-1', dataset: { i: String(i) } }));
      board.replaceChildren(...buttons);
      buttons.forEach((_, i) => paint(i));
      modeBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === key)));
      paintReadouts();
      hint();
    }

    function lay(safe) {
      const spare = new Set([safe]);
      if (N - 9 >= M.mines) around(safe).forEach(n => spare.add(n));
      const pool = [];
      for (let i = 0; i < N; i++) if (!spare.has(i)) pool.push(i);
      /* a race lays them from the room's seed, so both fields are the same */
      const rnd = raceRnd || Math.random;
      for (let k = 0; k < M.mines; k++) {
        const j = k + Math.floor(rnd() * (pool.length - k));
        [pool[k], pool[j]] = [pool[j], pool[k]];
        mine[pool[k]] = 1;
      }
      for (let i = 0; i < N; i++) adj[i] = around(i).reduce((s, n) => s + mine[n], 0);
      laid = true;
      startAt = performance.now();
      banked = 0;
      ticker = setInterval(tickClock, 200);
    }

    function tickClock() {
      if (dead || paused || over) return;
      paintReadouts();
    }

    function label(i) {
      const [r, c] = rc(i);
      const at = `Row ${r + 1}, column ${c + 1}`;
      if (cell[i] === 2) return `${at}, flagged`;
      if (cell[i] === 1) return adj[i] ? `${at}, ${adj[i]} ${adj[i] === 1 ? 'mine' : 'mines'} around` : `${at}, empty`;
      if (over && mine[i]) return `${at}, mine`;
      return `${at}, covered`;
    }

    function paint(i) {
      const b = buttons[i];
      if (!b) return;
      let cls = 'arx-mn__c';
      let html = '';
      let text = '';
      b.removeAttribute('data-n');
      if (cell[i] === 1) {
        cls += ' is-open';
        if (adj[i]) { cls += ' is-num'; text = String(adj[i]); b.dataset.n = String(adj[i]); }
      } else if (cell[i] === 2) {
        cls += ' is-flag';
        html = FLAG;
        if (over && !won && !mine[i]) cls += ' is-wrong';
        if (over && won) cls += ' is-won';
      } else if (over && mine[i]) {
        cls += won ? ' is-flag is-won' : ' is-mine';
        html = won ? FLAG : MINE;
      }
      if (over && !won && mine[i] && i === boomAt) { cls += ' is-boom'; html = MINE; }
      b.className = cls;
      if (html) b.innerHTML = html; else b.textContent = text;   // html is only ever the static FLAG/MINE svg
      b.setAttribute('aria-label', label(i));
    }

    function paintReadouts() {
      vFlags.textContent = String(M.mines - flags);
      const sec = elapsed() / 1000;
      vTime.textContent = over && laid ? sec.toFixed(1) : String(Math.floor(sec));
      const whole = Math.floor(sec);
      if (laid && !over && whole !== lastSec) { lastSec = whole; onScore(whole); }
    }

    /* ---- moves ---- */
    function open(i) {
      if (over || cell[i] !== 0) return;
      if (!laid) lay(i);
      if (mine[i]) return lose(i);
      const stack = [i];
      while (stack.length) {
        const k = stack.pop();
        if (cell[k] !== 0) continue;
        cell[k] = 1; opened++;
        paint(k);
        if (!adj[k]) for (const n of around(k)) if (cell[n] === 0 && !mine[n]) stack.push(n);
      }
      if (NET) NET.progress(opened / (N - M.mines));
      if (opened === N - M.mines) return win();
      paintReadouts();
    }

    function chord(i) {
      if (over || cell[i] !== 1 || !adj[i]) return;
      const ns = around(i);
      const flagged = ns.filter(n => cell[n] === 2).length;
      if (flagged !== adj[i]) { say(`${adj[i]} ${adj[i] === 1 ? 'mine' : 'mines'} around, ${flagged} flagged`); return; }
      for (const n of ns) { if (over) break; if (cell[n] === 0) open(n); }
    }

    function flag(i) {
      if (over || cell[i] === 1) return;
      if (cell[i] === 2) { cell[i] = 0; flags--; } else { cell[i] = 2; flags++; }
      paint(i);
      paintReadouts();
      say(cell[i] === 2 ? `Flagged. ${M.mines - flags} mines left` : 'Flag removed');
    }

    function end() {
      banked = elapsed();
      over = true;
      clearInterval(ticker); ticker = 0;
      root.classList.add('is-over');
      for (let i = 0; i < N; i++) paint(i);
      paintReadouts();
    }

    function win() {
      won = true;
      for (let i = 0; i < N; i++) if (mine[i] && cell[i] !== 2) { cell[i] = 2; flags++; }
      end();
      const score = Math.round(banked / 100) / 10;
      onScore(score);
      if (NET) {
        foot.replaceChildren(h('div.arx-mn__result', { role: 'status' }, icon('check'), 'Cleared in ', h('b', { text: `${score.toFixed(1)} s` }), ` · ${M.name}`));
        say(`Cleared in ${score.toFixed(1)} seconds.`);
        onEnd({ score, won: true, detail: `Race · cleared ${M.name} ${M.short} (${M.mines} mines) in ${score.toFixed(1)} s`, race: { done: true, ms: Math.round(banked), p: 1 } });
        return;
      }
      /* a custom board: its own best, per size and mine count */
      let note = '';
      if (M.custom) {
        const k = customKey(M), prev = customBest[k];
        if (!Number.isFinite(prev) || score < prev) customBest[k] = score;
        try { store.set(PREF, { ...prefNow(), customBest: { ...customBest } }); } catch (err) { /* a convenience */ }
        note = Number.isFinite(prev) ? (score < prev ? ' · a new best for this board' : ` · best here ${prev.toFixed(1)} s`) : ' · the first time on this board';
      }
      foot.replaceChildren(h('div.arx-mn__result', { role: 'status' }, icon('check'), 'Cleared in ', h('b', { text: `${score.toFixed(1)} s` }), ` · ${M.name}${M.custom ? ` ${M.short}, ${M.mines} mines` : ''}${note}`));
      say(`Cleared in ${score.toFixed(1)} seconds.`);
      onEnd({ score, won: true, detail: `Cleared ${M.name} ${M.short} (${M.mines} mines) in ${score.toFixed(1)} s${note}`, mode: modeKey,
        ...(M.custom ? { assisted: 'A custom board doesn’t change your best; it keeps its own' } : {}) });
    }

    function lose(i) {
      boomAt = i;
      end();
      const score = Math.round(banked / 100) / 10;
      const safe = N - M.mines;
      foot.replaceChildren(h('div.arx-mn__result.is-loss', { role: 'status' }, h('span', { html: MINE, style: { width: '15px', height: '15px', display: 'inline-flex' } }),
        `Boom — ${opened} of ${safe} safe cells cleared`));
      say(`Boom. You hit a mine. ${opened} of ${safe} safe cells cleared.`);
      /* a loss has no clearing time, so it reports no score: a quick bang
         must never become the "best" time in a lower-is-better game */
      if (NET) {
        onEnd({ score: null, won: false, detail: `Race · hit a mine after ${score.toFixed(1)} s · ${opened} of ${safe} safe cells cleared`, race: { done: false, p: opened / safe, ms: Math.round(banked) } });
        return;
      }
      onEnd({ score: null, won: false, detail: `Hit a mine after ${score.toFixed(1)} s · ${opened} of ${safe} safe cells cleared · ${M.name} ${M.short}`, mode: modeKey, seconds: score });
    }

    function moveFocus(i) {
      buttons[focusIdx]?.setAttribute('tabindex', '-1');
      focusIdx = i;
      buttons[i].setAttribute('tabindex', '0');
      buttons[i].focus({ preventScroll: true });
    }

    /* ---- input ---- */
    /* what a click, Enter/Space or a pad's A does to a cell */
    function activate(i) {
      if (cell[i] === 1) return chord(i);
      if (flagMode) return flag(i);
      if (cell[i] === 2) return;
      open(i);
    }
    /* the cell an arrow (or Home/End) moves to from i, or -1 */
    function step(i, key) {
      const [r, c] = rc(i);
      if (key === 'ArrowRight') return r * M.cols + Math.min(M.cols - 1, c + 1);
      if (key === 'ArrowLeft') return r * M.cols + Math.max(0, c - 1);
      if (key === 'ArrowDown') return Math.min(M.rows - 1, r + 1) * M.cols + c;
      if (key === 'ArrowUp') return Math.max(0, r - 1) * M.cols + c;
      if (key === 'Home') return r * M.cols;
      if (key === 'End') return r * M.cols + M.cols - 1;
      return -1;
    }
    const cellOf = e => {
      const b = e.target.closest?.('.arx-mn__c');
      return b && board.contains(b) ? Number(b.dataset.i) : -1;
    };

    listen(board, 'click', e => {
      const i = cellOf(e);
      if (i < 0 || dead || paused) return;
      if (i === skip.i && performance.now() < skip.until) { skip.i = -1; return; }
      lastInput = e.detail === 0 ? 'key' : 'pointer';
      if (focusIdx !== i) { buttons[focusIdx]?.setAttribute('tabindex', '-1'); focusIdx = i; buttons[i].setAttribute('tabindex', '0'); }
      activate(i);
    });
    listen(board, 'contextmenu', e => {
      e.preventDefault();
      const i = cellOf(e);
      if (i < 0 || dead || paused) return;
      cancelLongPress();
      /* Android turns a long-press into a contextmenu too — that one was already handled */
      if (e.pointerType !== 'mouse' && i === skip.i && performance.now() < skip.until) return;
      if (cell[i] === 1) return chord(i);
      flag(i);
    });
    listen(board, 'pointerdown', e => {
      lastInput = 'pointer';
      if (e.pointerType === 'mouse') return;
      const i = cellOf(e);
      if (i < 0 || over) return;
      cancelLongPress();
      lp = {
        i, x: e.clientX, y: e.clientY,
        timer: setTimeout(() => {
          lp = null;
          if (dead || paused || over) return;
          skip = { i, until: performance.now() + 700 };
          if (cell[i] === 1) chord(i);
          else if (flagMode) open(i);  // in flag mode a long-press opens instead
          else flag(i);
          try { navigator.vibrate?.(12); } catch (err) { /* not supported */ }
        }, LONG_PRESS),
      };
    });
    function cancelLongPress() { if (lp) { clearTimeout(lp.timer); lp = null; } }
    listen(board, 'pointermove', e => {
      if (lp && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 10) cancelLongPress();
    });
    listen(board, 'pointerup', cancelLongPress);
    listen(board, 'pointercancel', cancelLongPress);
    listen(board, 'pointerover', e => { const i = cellOf(e); if (i >= 0) hoverIdx = i; });
    listen(board, 'pointerleave', () => { hoverIdx = -1; });
    listen(board, 'keydown', e => {
      const i = cellOf(e);
      if (i < 0) return;
      const n = step(i, e.key);
      if (n < 0) return;
      e.preventDefault();
      lastInput = 'key';
      moveFocus(n);
    });
    /* keep the roving tab stop wherever focus lands (Tab, a click, a screen reader) */
    listen(board, 'focusin', e => {
      const i = cellOf(e);
      if (i < 0 || i === focusIdx) return;
      buttons[focusIdx]?.setAttribute('tabindex', '-1');
      focusIdx = i;
      buttons[i].setAttribute('tabindex', '0');
    });
    /* F flags the cell under the mouse, or the focused one.
       Keys that never pass through a cell are handled here too: after a
       pause the Arcade focuses its own stage, and the controller bridge
       dispatches straight to window, where neither the board's keydown
       nor a button's native Enter/Space can see them. From there an arrow
       walks on from the focused cell (or brings focus back to the board)
       and Space/Enter open the focused cell. */
    listen(window, 'keydown', e => {
      if (dead || paused) return;
      if (e.target instanceof Element && e.target.closest('input')) return;     /* typing a custom board's size */
      const fromBoard = e.target instanceof Node && board.contains(e.target);
      const isFlag = e.key === 'f' || e.key === 'F' || (!e.isTrusted && !!e.code && e.code === padFlagCode());
      const act = !fromBoard && (e.key === ' ' || e.key === 'Enter');
      const move = !fromBoard && step(focusIdx, e.key) >= 0;
      if (!isFlag && !act && !move) return;
      if (!ownsKey(root, e)) return;
      if (isFlag) {
        if (over) return;
        e.preventDefault();
        if (e.repeat) return;
        const inBoard = board.contains(document.activeElement);
        const i = lastInput === 'pointer' && hoverIdx >= 0 ? hoverIdx : inBoard ? focusIdx : hoverIdx;
        if (i >= 0) flag(i);
        return;
      }
      if (over && act) return;       // Enter after the round belongs to the Arcade's "play again"
      e.preventDefault();
      lastInput = 'key';
      if (!board.contains(document.activeElement)) { moveFocus(focusIdx); return; }
      if (move) { moveFocus(step(focusIdx, e.key)); return; }
      if (!e.repeat) activate(focusIdx);
    });
    const onPads = () => { if (!dead) hint(); };
    listen(window, 'gamepadconnected', onPads);
    listen(window, 'gamepaddisconnected', onPads);
    const offPad = store.sub?.(padmap.KEY, onPads);
    if (offPad) offs.push(offPad);

    listen(seg, 'click', e => {
      const b = e.target.closest?.('button[data-mode]');
      if (!b || dead) return;
      const key = b.dataset.mode;
      /* Custom first shows its settings; Play deals the board */
      if (key === 'custom') {
        customBar.hidden = !customBar.hidden;
        if (!customBar.hidden) { paintDensity(); colsIn.focus({ preventScroll: true }); say('Custom board: set the columns, rows and mines, then Play.'); }
        return;
      }
      customBar.hidden = true;
      try { store.set(PREF, { ...(store.get(PREF) || {}), mode: key }); } catch (err) { /* storage is a convenience */ }
      if (key === modeKey && !laid) return;
      build(key);
      say(`${MODES[key].name}, ${MODES[key].short}, ${MODES[key].mines} mines. New board.`);
    });
    for (const inp of [colsIn, rowsIn, minesIn]) {
      listen(inp, 'input', paintDensity);
      listen(inp, 'keydown', e => { if (e.key === 'Enter') { e.preventDefault(); startCustom(); } });
    }
    listen(playCustom, 'click', () => startCustom());
    function startCustom() {
      if (dead) return;
      const b = customBoard(colsIn.value, rowsIn.value, minesIn.value);
      custom = { cols: b.cols, rows: b.rows, mines: b.mines };
      colsIn.value = String(b.cols); rowsIn.value = String(b.rows); minesIn.value = String(b.mines);
      paintDensity();
      try { store.set(PREF, { ...prefNow(), mode: 'custom', custom }); } catch (err) { /* storage is a convenience */ }
      customBar.hidden = true;
      build('custom');
      const fixedNote = b.fixed.length ? ` (${b.fixed.join(' and ')} kept to what fits)` : '';
      say(`Custom: ${b.cols} columns by ${b.rows} rows, ${b.mines} mines${fixedNote}. New board.`);
      foot.replaceChildren(h('span.arx-mn__hint', { text: `Custom ${b.cols}×${b.rows}, ${b.mines} mines${fixedNote}.${Number.isFinite(customBest[customKey(b)]) ? ` Best here ${customBest[customKey(b)].toFixed(1)} s.` : ''}` }));
      requestAnimationFrame(() => { if (!dead) buttons[focusIdx]?.focus({ preventScroll: true }); });
    }
    listen(flagBtn, 'click', () => {
      flagMode = !flagMode;
      flagBtn.setAttribute('aria-pressed', String(flagMode));
      say(flagMode ? 'Flag mode on: taps place flags' : 'Flag mode off');
    });
    listen(newBtn, 'click', () => { if (NET) return; build(modeKey); say('New board'); });

    build(modeKey);
    /* a race opens the same safe square on both screens, from the seed: the clock starts there */
    if (NET) {
      raceSafe = Math.floor(raceRnd() * N);
      focusIdx = raceSafe;
      buttons.forEach((b, i) => b.setAttribute('tabindex', i === raceSafe ? '0' : '-1'));
      open(raceSafe);
      say(`Race: the same Beginner field as ${NET.peer?.name || 'your friend'}, opened at the same square.`);
    }
    requestAnimationFrame(() => { if (!dead) buttons[focusIdx]?.focus({ preventScroll: true }); });

    return {
      stop() {
        if (dead) return;
        dead = true;
        clearInterval(ticker); ticker = 0;
        cancelLongPress();
        offs.splice(0).forEach(off => off());
        root.remove();
      },
      pause() {
        if (dead || paused) return;
        if (laid && !over) banked += performance.now() - startAt;
        paused = true;
        cancelLongPress();
        if (!over) board.appendChild(h('div.arx-mn__cover', { text: 'Paused' }));
      },
      resume() {
        if (dead || !paused) return;
        paused = false;
        if (laid && !over) startAt = performance.now();
        board.querySelector('.arx-mn__cover')?.remove();
      },
      /* a read-only snapshot for automated play-tests */
      peek: () => ({
        mode: modeKey, cols: M.cols, rows: M.rows, mines: M.mines, custom: { ...custom }, customBest: { ...customBest }, laid, over, won, opened, flags,
        mineAt: laid ? [...mine].map((v, i) => (v ? i : -1)).filter(i => i >= 0) : [], cell: [...cell], customOpen: !customBar.hidden,
        adj: laid ? [...adj] : [],
        race: NET ? { seed: NET.seed >>> 0, safe: raceSafe } : null,
      }),
    };
  },
};

/* Keys reach the game only while its window is the active one and focus
   is not parked on some other control (a shell button, a text field).
   The controller bridge (core/padmap.js) dispatches its synthetic keys
   straight to window, so for those the focused element stands in for
   the target (Node.contains(window) would throw). */
function ownsKey(root, e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (!root.isConnected || !root.getClientRects().length) return false;
  const win = root.closest('.win');
  if (win && !win.classList.contains('is-active')) return false;
  const t = e.target instanceof Element ? e.target : document.activeElement;
  if (!t || t === document.body || t === document.documentElement || root.contains(t)) return true;
  if (t.closest('input,textarea,select,button,a[href],[contenteditable="true"],[role="button"]')) return false;
  return !win || win.contains(t);
}
