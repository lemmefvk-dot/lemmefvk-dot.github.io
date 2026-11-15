/* ============================================================
   arcade/pegs.js — Peg Drop for Static Arcade.

   Ten balls. Move the dropper along the top (mouse, finger, or ← →),
   and drop a ball (click, tap, Space): it bounces down through the pegs
   into a slot, and the slot's number is your score. Green pegs add 1
   the first time a ball touches them. Where to drop is the whole
   skill: the same seed is the same board with the same slot numbers,
   so a Beat-this link, a ghost and a friend's score are all fair.
   Rules in ./pegs-logic.js, the engine in ./simkit.js.

   All art is drawn in code. Reduced motion: no screen shake, no spark
   on a green peg.
   ============================================================ */
import { hsl, FONT } from './kit.js';
import { simGame } from './simkit.js';
import * as L from './pegs-logic.js';

const HUE = 305;

function draw(g, s, X) {
  const ui = X.ui;
  if (ui.cx === undefined) ui.cx = 200;
  if (ui.dir) ui.cx = Math.max(12, Math.min(388, ui.cx + ui.dir * 230 * (X.dt || 0)));
  const bg = ui.bg || (ui.bg = (() => { const q = g.createLinearGradient(0, 0, 0, L.VH); q.addColorStop(0, '#1b1233'); q.addColorStop(1, '#0d0a1e'); return q; })());
  g.fillStyle = bg; g.fillRect(0, 0, L.VW, L.VH);
  /* slots */
  for (let i = 0; i < L.SLOTS; i++) {
    const v = s.b.values[i], x = i * L.SLOT_W;
    g.fillStyle = hsl(305 - v * 14, 70, 20 + v * 3, 0.9); g.fillRect(x + 2, L.FLOOR, L.SLOT_W - 4, L.VH - L.FLOOR);
    g.fillStyle = '#fff'; g.font = `800 15px ${FONT}`; g.textAlign = 'center'; g.fillText(String(v), x + L.SLOT_W / 2, L.FLOOR + 26);
    if (s.slots[i]) { g.fillStyle = 'rgba(255,255,255,.55)'; g.font = `700 10px ${FONT}`; g.fillText(`×${s.slots[i]}`, x + L.SLOT_W / 2, L.FLOOR + 44); }
  }
  g.strokeStyle = '#8b7bd8'; g.lineWidth = 3;
  g.beginPath(); for (let i = 0; i <= L.SLOTS; i++) { g.moveTo(i * L.SLOT_W, L.FLOOR); g.lineTo(i * L.SLOT_W, L.VH); } g.stroke();
  /* pegs */
  const pegs = s.b.pegs;
  g.fillStyle = '#c9c2f0';
  g.beginPath(); for (let i = 0; i < pegs.length; i++) { const p = pegs[i]; if (p.bonus < 0) { g.moveTo(p.x + L.PR, p.y); g.arc(p.x, p.y, L.PR, 0, 6.2832); } } g.fill();
  for (let i = 0; i < pegs.length; i++) {
    const p = pegs[i];
    if (p.bonus < 0) continue;
    g.fillStyle = '#4de08a'; g.beginPath(); g.arc(p.x, p.y, L.PR + 1, 0, 6.2832); g.fill();
    g.strokeStyle = 'rgba(77,224,138,.45)'; g.lineWidth = 1.5; g.beginPath(); g.arc(p.x, p.y, L.PR + 4, 0, 6.2832); g.stroke();
  }
  /* the ghost's balls, then yours */
  if (X.G) { g.fillStyle = 'rgba(255,255,255,.3)'; for (const b of X.G.balls) if (b.on) { g.beginPath(); g.arc(b.x, b.y, L.BR, 0, 6.2832); g.fill(); } }
  g.fillStyle = '#ffd23f';
  for (const b of s.balls) if (b.on) { g.beginPath(); g.arc(b.x, b.y, L.BR, 0, 6.2832); g.fill(); }
  /* the dropper */
  if (!s.over) {
    const can = s.dropped < L.BALLS && L.live(s) < L.MAX_LIVE;
    g.strokeStyle = can ? 'rgba(255,210,63,.6)' : 'rgba(255,255,255,.2)'; g.setLineDash([5, 6]); g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(ui.cx, 52); g.lineTo(ui.cx, 100); g.stroke(); g.setLineDash([]);
    g.fillStyle = can ? '#ffd23f' : 'rgba(255,255,255,.3)';
    g.beginPath(); g.moveTo(ui.cx - 12, 22); g.lineTo(ui.cx + 12, 22); g.lineTo(ui.cx, 46); g.closePath(); g.fill();
  }
  g.textAlign = 'left'; g.fillStyle = '#fff'; g.font = `800 20px ${FONT}`; g.fillText(String(s.score), 14, 30);
  g.font = `600 12px ${FONT}`; g.fillStyle = 'rgba(255,255,255,.8)';
  g.fillText(`${L.BALLS - s.dropped} ball${L.BALLS - s.dropped === 1 ? '' : 's'} left`, 14, 48);
}

export default simGame({
  title: 'Peg Drop', hue: HUE, VW: L.VW, VH: L.VH, bg: '#0d0a1e', over: 'All dropped',
  create: L.create, step: L.step, act: L.act, score: L.score,
  detail: s => `${s.landed} ball${s.landed === 1 ? '' : 's'} home · best slot ${Math.max(0, ...s.b.values.filter((v, i) => s.slots[i]))}`,
  hint: touch => (touch ? 'tap where a ball should drop · ten balls' : 'move with the mouse or ← → · click or Space drops a ball'),
  draw,
  uiKey(code, down, ui) {
    if (code === 'ArrowLeft' || code === 'KeyA') { ui.dir = down ? -1 : (ui.dir === -1 ? 0 : ui.dir); return true; }
    if (code === 'ArrowRight' || code === 'KeyD') { ui.dir = down ? 1 : (ui.dir === 1 ? 0 : ui.dir); return true; }
    return false;
  },
  keyEvent: (s, code, down, ui) => (down && (code === 'Space' || code === 'ArrowDown' || code === 'KeyS') ? ['d', Math.round(ui.cx === undefined ? 200 : ui.cx)] : null),
  pointerEvent(s, kind, x, y, ui) {
    ui.cx = Math.max(12, Math.min(388, x));
    return kind === 'down' ? ['d', Math.round(ui.cx)] : null;
  },
  sfx(ev, snd) {
    if (ev.type === 'peg') snd.blip(ev.bonus ? 900 : 360 + (ev.x || 0) % 5 * 40, 0.03, 'triangle', 0.35);
    else if (ev.type === 'bonus') snd.blip(1200, 0.08, 'triangle', 0.7);
    else if (ev.type === 'slot') snd.blip(300 + ev.value * 60, 0.15, 'sine', 0.8);
    return false;
  },
  announce: ev => (ev.type === 'slot' ? `Slot ${ev.value}.` : ''),
  peek: (s, ui) => ({ dropped: s.dropped, landed: s.landed, live: L.live(s), balls: s.balls.map(b => ({ on: b.on, x: b.x, y: b.y })), values: s.b.values.slice(), cx: ui.cx === undefined ? 200 : ui.cx, slots: s.slots.slice(), bonusPegs: s.b.pegs.filter(p => p.bonus >= 0).length }),
});
