/* ============================================================
   arcade/rockdrift.js — Rock Drift for Static Arcade.

   Turn with ← →, thrust with ↑, shoot with Space. The sky wraps round
   at every edge, so nothing is ever really out of the way. Big rocks
   split into smaller ones; the smallest are worth most. Three ships,
   and a new one every 3000 points. Rules in ./rockdrift-logic.js, the
   engine in ./simkit.js; on a touch screen the on-screen buttons send
   the same keys.

   Same seed, same rocks: a ghost ship flies your best run beside you.
   All art is drawn in code. Reduced motion: no screen shake and no
   expanding rings.
   ============================================================ */
import { hsl, FONT, rng } from './kit.js';
import { simGame } from './simkit.js';
import * as L from './rockdrift-logic.js';

const HUE = 150;
const KEY = { ArrowLeft: 1, KeyA: 1, ArrowRight: 2, KeyD: 2, ArrowUp: 4, KeyW: 4, Space: 8 };
/* five rock outlines, ten corners each, as a fraction of the rock's radius */
const SHAPES = (() => { const r = rng(21); return Array.from({ length: 5 }, () => Array.from({ length: 10 }, () => 0.78 + r() * 0.3)); })();
const STARS = (() => { const r = rng(3); return Array.from({ length: 45 }, () => [r() * L.VW, r() * L.VH]); })();

function ship(g, x, y, a, alpha, flame, t, reduced) {
  g.save(); g.translate(x, y); g.rotate(a); g.globalAlpha = alpha;
  if (flame) { g.fillStyle = '#ffb347'; g.beginPath(); g.moveTo(-7, -3); g.lineTo(-14 - (reduced ? 2 : Math.sin(t * 50) * 3), 0); g.lineTo(-7, 3); g.closePath(); g.fill(); }
  g.strokeStyle = '#e8f6ee'; g.lineWidth = 2; g.fillStyle = 'rgba(80,220,160,.25)';
  g.beginPath(); g.moveTo(12, 0); g.lineTo(-8, 7); g.lineTo(-4, 0); g.lineTo(-8, -7); g.closePath(); g.fill(); g.stroke();
  g.restore();
}

function draw(g, s, X) {
  const ui = X.ui;
  g.fillStyle = '#060b10'; g.fillRect(0, 0, L.VW, L.VH);
  g.fillStyle = 'rgba(255,255,255,.5)';
  for (const st of STARS) g.fillRect(st[0], st[1], 1.4, 1.4);
  /* rocks */
  g.strokeStyle = '#cfe0d8'; g.lineWidth = 2; g.fillStyle = 'rgba(160,190,180,.08)';
  for (let i = 0; i < s.rocks.length; i++) {
    const k = s.rocks[i];
    if (!k.on) continue;
    const r = L.RADII[k.size], sh = SHAPES[k.shape];
    g.beginPath();
    for (let c = 0; c < 10; c++) { const a = c * 0.62832, q = r * sh[c]; if (c) g.lineTo(k.x + Math.cos(a) * q, k.y + Math.sin(a) * q); else g.moveTo(k.x + q, k.y); }
    g.closePath(); g.fill(); g.stroke();
  }
  g.fillStyle = '#ffe28a';
  for (let i = 0; i < s.shots.length; i++) { const sh = s.shots[i]; if (sh.on) g.fillRect(sh.x - 1.5, sh.y - 1.5, 3, 3); }
  /* rings where something blew up */
  if (ui.fx) for (const f of ui.fx) {
    if (f.life <= 0) continue;
    f.life -= X.dt || 0;
    g.strokeStyle = `rgba(255,220,150,${Math.max(0, f.life / 0.4)})`; g.lineWidth = 2;
    g.beginPath(); g.arc(f.x, f.y, f.r * (1 - f.life / 0.4) + 3, 0, 6.2832); g.stroke();
  }
  if (X.G && X.G.alive) ship(g, X.G.x, X.G.y, X.G.a, 0.3, X.G.thrusting, X.time, X.reduced);
  if (s.alive && !(s.safe > 0 && Math.floor(s.safe / 8) % 2 === 0 && !X.reduced)) ship(g, s.x, s.y, s.a, 1, s.thrusting, X.time, X.reduced);
  g.textAlign = 'left'; g.fillStyle = '#fff'; g.font = `800 20px ${FONT}`; g.fillText(String(s.score), 14, 28);
  g.font = `700 13px ${FONT}`; g.fillStyle = hsl(150, 60, 75);
  g.fillText(`${'▲'.repeat(Math.max(0, s.lives))}   wave ${s.wave}`, 14, 46);
}

export default simGame({
  title: 'Rock Drift', hue: HUE, VW: L.VW, VH: L.VH, bg: '#060b10', over: 'Out of ships',
  create: L.create, step: L.step, act: L.act, score: L.score,
  detail: s => `Wave ${s.wave} · ${s.kills} rock${s.kills === 1 ? '' : 's'} shot with ${s.shotsFired} shot${s.shotsFired === 1 ? '' : 's'}`,
  hint: touch => (touch ? 'use the buttons: turn, thrust, fire · the sky wraps round' : '← → turn · ↑ thrust · Space fires · the sky wraps round'),
  draw,
  keyEvent(s, code, down) {
    const b = KEY[code];
    if (!b) return null;
    const m = down ? s.keys | b : s.keys & ~b;
    return m === s.keys ? null : ['k', m];
  },
  sfx(ev, snd, ui) {
    if (ev.type === 'shoot') snd.blip(720, 0.04, 'square', 0.4, 300);
    else if (ev.type === 'boom') {
      snd.blip(180 - ev.size * 30, 0.12, 'sawtooth', 0.6, 60);
      if (!ui.fx) ui.fx = Array.from({ length: 10 }, () => ({ x: 0, y: 0, r: 0, life: 0 }));
      const f = ui.fx.find(q => q.life <= 0) || ui.fx[0];
      f.x = ev.x; f.y = ev.y; f.r = L.RADII[ev.size] + 8; f.life = 0.4;
    } else if (ev.type === 'die') { snd.blip(120, 0.35, 'sawtooth', 0.9, 40); return true; }
    else if (ev.type === 'life') snd.blip(900, 0.2, 'triangle', 0.8, 1300);
    return false;
  },
  announce: ev => (ev.type === 'die' ? 'Ship lost.' : ev.type === 'wave' && ev.n > 1 ? `Wave ${ev.n}.` : ev.type === 'life' ? 'Extra ship.' : ''),
  peek: s => ({
    x: s.x, y: s.y, a: s.a, vx: s.vx, vy: s.vy, lives: s.lives, wave: s.wave, alive: s.alive, safe: s.safe, keys: s.keys, kills: s.kills, shotsFired: s.shotsFired,
    rocks: s.rocks.filter(k => k.on).map(k => ({ x: k.x, y: k.y, size: k.size, vx: k.vx * 60, vy: k.vy * 60 })), shots: s.shots.filter(q => q.on).length,
  }),
});
