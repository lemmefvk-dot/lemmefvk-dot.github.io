/* ============================================================
   arcade/ng1kit.js — what Signal Relay, Robo Tiles, Bridge Builder,
   Rail Switch and Word Ladder share on top of puzzlekit.js: a level
   list with ticks and stars, a result card, a code box (copy a code,
   open one) and a few small helpers. Pure DOM, no saved data of its
   own (each game keeps its own through puzzlekit.js).
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';

export const NG_CSS = `
.ng__bw{position:relative;flex:1 1 auto;min-width:0;min-height:0;width:100%;container-type:size;display:grid;place-items:center}
.ng__board{position:relative;border-radius:12px;background:#0d0f16;border:2px solid var(--line-2,rgba(255,255,255,.22));outline:none;touch-action:none;display:block}
.ng__board:focus-visible{box-shadow:0 0 0 2px var(--ga)}
.ng__card{position:absolute;inset:0;display:grid;place-items:center;z-index:4;background:rgba(10,8,16,.8);border-radius:12px;text-align:center;padding:16px}
.ng__card b{display:block;font-size:22px;margin-bottom:6px;color:#fff}
.ng__card span{display:block;font-size:13px;color:var(--ink-2,#bbb);max-width:46ch;margin:0 auto 10px}
.ng__card .pz__btn{margin:0 auto}
.ng__levels{position:absolute;inset:0;z-index:5;overflow:auto;padding:14px;background:rgba(12,9,18,.96);border-radius:12px}
.ng__levels h4{margin:0 0 4px;font:700 13px/1.2 var(--font,system-ui);color:#fff}
.ng__levels p{margin:0 0 10px;font-size:12px;color:var(--ink-2,#bbb)}
.ng__lv{display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:6px;margin-bottom:12px}
.ng__lv button{display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 4px;border-radius:9px;border:1px solid var(--line-1,rgba(255,255,255,.1));background:var(--fill-1,rgba(255,255,255,.06));color:var(--ink-0,#fff);font:700 14px/1 var(--font,system-ui);cursor:pointer}
.ng__lv button small{font:600 10px/1 var(--font,system-ui);color:var(--ink-3,#999)}
.ng__lv button.is-done{border-color:color-mix(in srgb,#2fd36b 55%,transparent)}
.ng__lv button.is-par small{color:#ffd23f}
.ng__lv button.is-cur{box-shadow:0 0 0 2px var(--ga)}
.ng__lv button:focus-visible{outline:2px solid var(--ga)}
.ng__code{width:min(100%,760px);display:flex;flex-wrap:wrap;gap:6px;align-items:center;justify-content:center;flex:0 0 auto}
.ng__code input{flex:1 1 200px;min-width:0;font:500 12px/1 var(--mono,ui-monospace,monospace);padding:8px 10px;border-radius:var(--r-md,11px);border:1px solid var(--line-2,rgba(255,255,255,.18));background:var(--fill-0,rgba(255,255,255,.04));color:var(--ink-0,#fff)}
.ng__code input:focus-visible{outline:2px solid var(--ga)}
.ng__tools{width:min(100%,760px);display:flex;flex-wrap:wrap;gap:5px;justify-content:center;flex:0 0 auto}
.ng__tools button{min-width:34px}
.pz__read.is-over{color:#ffb46b}
.pz__read.is-good{color:#7ee6a0}
@keyframes ng-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}
.pz:not(.is-reduced) .is-shake{animation:ng-shake .22s linear}
`;

/** a grid of level buttons: info(i) -> { done, star, note } (note: the small text under the number) */
export function levelGrid(count, cur, info, onPick, label = 'Levels') {
  return h('div.ng__lv', { role: 'group', 'aria-label': label }, Array.from({ length: count }, (_, i) => {
    const o = info(i) || {};
    return h('button', {
      type: 'button', dataset: { index: i }, class: `${o.done ? 'is-done ' : ''}${o.star ? 'is-par ' : ''}${i === cur ? 'is-cur' : ''}`, title: o.title || `Level ${i + 1}`,
      onclick: () => onPick(i),
    }, String(i + 1), h('small', { text: o.note || '' }));
  }));
}

/** the result card laid over the board; returns the element */
export function resultCard(title, text, ...buttons) {
  return h('div.ng__card', { role: 'status' }, h('div', h('b', { text: title }), h('span', { text }), ...buttons));
}
export const cardButton = (label, onclick, iconName) => h('button.pz__btn', { type: 'button', onclick }, iconName ? icon(iconName) : null, h('span', { text: label }));

/** copy text to the clipboard; false if the browser won't */
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (err) { /* fall through */ }
  try {
    const t = h('textarea', { value: text, style: { position: 'fixed', left: '-999px', top: '0' }, readonly: '' });
    document.body.appendChild(t);
    t.select();
    const done = document.execCommand?.('copy');
    t.remove();
    return !!done;
  } catch (err) { return false; }
}

/** a text box with an Open button and a Copy button: onOpen(text) gets what was typed */
export function codeBar({ placeholder, openLabel = 'Open code', onOpen, onCopy, copyLabel = 'Copy code' }) {
  const input = h('input', { type: 'text', placeholder, 'aria-label': placeholder, spellcheck: 'false', autocomplete: 'off', maxlength: '4000' });
  const openB = h('button.pz__btn', { type: 'button', dataset: { act: 'open-code' }, onclick: () => onOpen(input.value) }, icon('upload'), h('span', { text: openLabel }));
  const copyB = onCopy ? h('button.pz__btn', { type: 'button', dataset: { act: 'copy-code' }, onclick: () => onCopy() }, icon('copy'), h('span', { text: copyLabel })) : null;
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); onOpen(input.value); } e.stopPropagation(); });
  return { el: h('div.ng__code', input, openB, copyB), input };
}

/** seconds with one decimal for a record */
export const secs1 = s => Math.round(s * 10) / 10;

/** a click handler for a game's root: a button pressed with the mouse or a finger lets go of focus, so the game's
    keys (Enter, Space, letters) keep going to the game; a button "pressed" from the keyboard keeps it */
export const blurMouse = e => { if (e.detail > 0) e.target?.closest?.('button')?.blur?.(); };
