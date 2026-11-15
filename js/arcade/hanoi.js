/* ============================================================
   arcade/hanoi.js — Disc Towers for Static Arcade.

   Move the whole stack of discs to the last peg, one disc at a time,
   never onto a smaller one. Pick the peg to take a disc from, then the
   peg to put it on: click or tap the pegs, or press 1–4, or use ← →
   and Space. Ten levels: three pegs with three to eight discs, then
   four pegs, where there is a faster way. Each par is the fewest
   moves possible, and ./hanoi-logic.js solves every level again in the
   suite to prove it. U takes a move back, R starts over, H shows the
   next move of a shortest way (and that level then sets no best).

   The page chrome and saved progress are ./levelkit.js. All art is
   drawn in code and nothing moves on its own.
   ============================================================ */
import { rr, hsl } from './kit.js';
import { levelGame } from './levelkit.js';
import { LEVELS, start, move, isSolved, solve, stack } from './hanoi-logic.js';

const HUE = 265;

const pegAt = (x, w, pegs) => Math.max(0, Math.min(pegs - 1, Math.floor(x / (w / pegs))));

/* pick a peg: the first pick is where a disc comes from, the second where it goes */
function pick(ui, peg, pos) {
  if (ui.sel == null) { if (stack(pos, peg).length) { ui.sel = peg; } return null; }
  const a = ui.sel; ui.sel = null;
  return a === peg ? null : [a, peg];
}

function draw(g, w, hh, lv, pos, X) {
  const ui = X.ui, pegs = lv.pegs, colW = w / pegs;
  g.fillStyle = '#0e1420'; g.fillRect(0, 0, w, hh);
  const base = hh - 36, top = 40;
  const dh = Math.max(10, Math.min(26, (base - top - 10) / Math.max(8, lv.n + 1)));
  const maxW = colW * 0.86, minW = Math.max(22, colW * 0.18);
  g.fillStyle = '#39405a'; rr(g, 10, base, w - 20, 12, 6); g.fill();
  for (let p = 0; p < pegs; p++) {
    const cx = colW * (p + 0.5), sel = ui.sel === p, cur = ui.cur === p;
    g.fillStyle = sel ? '#ffd23f' : cur ? '#8aa0ff' : '#55607f';
    rr(g, cx - 4, top, 8, base - top, 4); g.fill();
    const st = stack(pos, p);
    for (let k = 0; k < st.length; k++) {
      const d = st[st.length - 1 - k];                 /* bottom first */
      const dw = minW + (maxW - minW) * (d / Math.max(1, lv.n - 1));
      const lift = sel && k === st.length - 1 ? 18 : 0;
      const y = base - (k + 1) * dh - lift;
      g.fillStyle = hsl(Math.round(d * 360 / lv.n + 200) % 360, 70, 58); rr(g, cx - dw / 2, y, dw, dh - 2, 6); g.fill();
      g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(cx - dw / 2 + 5, y + 2, dw - 10, 3);
      if (sel && k === st.length - 1) { g.strokeStyle = '#ffd23f'; g.lineWidth = 2; rr(g, cx - dw / 2, y, dw, dh - 2, 6); g.stroke(); }
    }
    g.fillStyle = 'rgba(255,255,255,.55)'; g.font = '700 12px Inter,system-ui,sans-serif'; g.textAlign = 'center'; g.fillText(String(p + 1), cx, base + 28);
    if (p === pegs - 1) { g.fillStyle = '#5ee08a'; g.fillText('goal', cx, 26); }
  }
  if (X.hint) {
    const [a, b] = X.hint, ax = colW * (a + 0.5), bx = colW * (b + 0.5), y = top - 4;
    g.strokeStyle = '#ffd23f'; g.fillStyle = '#ffd23f'; g.lineWidth = 3; g.lineCap = 'round';
    g.beginPath(); g.moveTo(ax, y + 14); g.quadraticCurveTo((ax + bx) / 2, y - 14, bx, y + 14); g.stroke();
    g.beginPath(); g.moveTo(bx, y + 20); g.lineTo(bx - 7, y + 10); g.lineTo(bx + 7, y + 10); g.closePath(); g.fill();
  }
  if (X.solved) { g.fillStyle = 'rgba(94,224,138,.14)'; g.fillRect(0, 0, w, hh); }
}

export default levelGame({
  game: 'hanoi', title: 'Disc Towers', hue: HUE, levels: LEVELS,
  help: 'Click a peg, then another · or 1–4 · ← → and Space · U undo · R restart · H hint · PageUp / PageDown change level',
  newUi: () => ({ sel: null, cur: 0 }),
  init: lv => start(lv),
  apply: (lv, pos, a) => move(pos, a[0], a[1]),
  solved: (lv, pos) => isSolved(lv, pos),
  hint: (lv, pos) => { const r = solve(lv, pos); return r && r.path.length ? r.path[0] : null; },
  hintText: a => `Hint: move the top disc from peg ${a[0] + 1} to peg ${a[1] + 1}.`,
  keyAction(code, lv, pos, ui) {
    const m = /^(?:Digit|Numpad)([1-9])$/.exec(code);
    if (m) { const p = +m[1] - 1; if (p >= lv.pegs) return null; ui.cur = p; return pick(ui, p, pos); }
    if (code === 'ArrowLeft' || code === 'KeyA') { ui.cur = Math.max(0, (ui.cur ?? 0) - 1); return null; }
    if (code === 'ArrowRight' || code === 'KeyD') { ui.cur = Math.min(lv.pegs - 1, (ui.cur ?? 0) + 1); return null; }
    if (code === 'Space' || code === 'ArrowDown' || code === 'ArrowUp') return pick(ui, ui.cur ?? 0, pos);
    return undefined;
  },
  pointerAction(x, y, w, hh, lv, pos, ui) { const p = pegAt(x, w, lv.pegs); ui.cur = p; return pick(ui, p, pos); },
  draw,
  peek: (lv, pos, ui) => ({ pegs: lv.pegs, discs: lv.n, pos: pos.slice(), sel: ui.sel, cur: ui.cur ?? 0, stacks: Array.from({ length: lv.pegs }, (_, p) => stack(pos, p).length) }),
});
