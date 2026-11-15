/* ============================================================
   arcade/touchdown.js — Soft Touchdown for Static Arcade.

   Turn with ← →, burn with ↑ (or Space), and set the lander down on a
   flat pad: slowly, nearly upright, with fuel to spare. Each moon is
   rougher than the last and its pads narrower; the narrow pad pays x3.
   Rules (and an autopilot the tests use) in ./touchdown-logic.js; the
   engine in ./simkit.js. On a touch screen the on-screen buttons send
   the same keys.

   Same seed, same moons: a ghost lander flies your best run beside
   you. All art is drawn in code. Reduced motion: no screen shake and
   a steady flame.
   ============================================================ */
import { rr, hsl, FONT, rng } from './kit.js';
import { simGame } from './simkit.js';
import * as L from './touchdown-logic.js';

const HUE = 200;
const STARS = (() => { const r = rng(5); return Array.from({ length: 50 }, () => [r() * L.VW, r() * 230, 0.5 + r() * 1.3]); })();
const KEY = { ArrowLeft: 1, KeyA: 1, ArrowRight: 2, KeyD: 2, ArrowUp: 4, KeyW: 4, Space: 4 };

function craft(g, x, y, a, alpha, flame, reduced, t) {
  g.save(); g.translate(x, y); g.rotate(a); g.globalAlpha = alpha;
  if (flame) {
    g.fillStyle = '#ffb347'; g.beginPath(); g.moveTo(-5, 7); g.lineTo(0, 16 + (reduced ? 4 : Math.sin(t * 40) * 3 + 3)); g.lineTo(5, 7); g.closePath(); g.fill();
    g.fillStyle = '#fff3b0'; g.beginPath(); g.moveTo(-2.5, 7); g.lineTo(0, 11); g.lineTo(2.5, 7); g.closePath(); g.fill();
  }
  g.strokeStyle = '#cfd8e3'; g.lineWidth = 2; g.beginPath(); g.moveTo(-5, 4); g.lineTo(-10, 10); g.moveTo(5, 4); g.lineTo(10, 10); g.stroke();
  g.fillStyle = '#e8edf3'; g.beginPath(); g.moveTo(-6, 6); g.lineTo(-7, -2); g.lineTo(0, -9); g.lineTo(7, -2); g.lineTo(6, 6); g.closePath(); g.fill();
  g.fillStyle = '#4aa8ff'; g.beginPath(); g.arc(0, -2, 3.2, 0, 7); g.fill();
  g.restore();
}

function draw(g, s, X) {
  const m = s.moon;
  const grd = X.ui.bg || (X.ui.bg = (() => { const q = g.createLinearGradient(0, 0, 0, L.VH); q.addColorStop(0, '#05070f'); q.addColorStop(1, '#1a2440'); return q; })());
  g.fillStyle = grd; g.fillRect(0, 0, L.VW, L.VH);
  g.fillStyle = '#fff';
  for (const st of STARS) { g.globalAlpha = 0.35 + st[2] * 0.25; g.fillRect(st[0], st[1], st[2], st[2]); }
  g.globalAlpha = 1;
  /* the ground */
  g.fillStyle = '#8f93a3'; g.beginPath(); g.moveTo(0, L.VH);
  for (let i = 0; i < L.COLS; i++) g.lineTo(i * L.SEG, m.ground[i]);
  g.lineTo(L.VW, L.VH); g.closePath(); g.fill();
  g.strokeStyle = '#c9cdda'; g.lineWidth = 2; g.beginPath();
  for (let i = 0; i < L.COLS; i++) { if (i) g.lineTo(i * L.SEG, m.ground[i]); else g.moveTo(0, m.ground[0]); }
  g.stroke();
  for (const p of m.pads) {
    g.fillStyle = p.mult > 1 ? '#ffd23f' : '#5ee08a'; g.fillRect(p.x0, p.y - 3, p.x1 - p.x0, 4);
    g.fillStyle = '#fff'; g.font = `800 12px ${FONT}`; g.textAlign = 'center'; g.fillText(`x${p.mult}`, (p.x0 + p.x1) / 2, p.y + 16);
  }
  if (X.G && !X.G.over && X.G.level === s.level) craft(g, X.G.x, X.G.y, X.G.a, 0.4, X.G.thrusting, X.reduced, X.time);
  if (s.phase !== 'crashed') craft(g, s.x, s.y, s.a, 1, s.thrusting, X.reduced, X.time);
  else {
    g.fillStyle = '#ff7a3c'; g.beginPath(); g.arc(s.x, s.y, 16, 0, 7); g.fill();
    g.fillStyle = '#ffe28a'; g.beginPath(); g.arc(s.x, s.y, 8, 0, 7); g.fill();
  }
  /* the readout: speed turns red where a landing would fail */
  const bad = Math.abs(s.vx) > L.MAX_VX || s.vy > L.MAX_VY;
  g.textAlign = 'left'; g.font = `700 13px ${FONT}`; g.fillStyle = '#fff';
  g.fillText(`Moon ${s.level}   ${s.score} points`, 14, 24);
  g.fillStyle = bad ? '#ff8a8a' : '#9be8b3';
  g.fillText(`sideways ${Math.round(s.vx)}   down ${Math.round(s.vy)}   tilt ${Math.round(s.a * 57.3)}°`, 14, 42);
  g.fillStyle = 'rgba(255,255,255,.18)'; rr(g, L.VW - 150, 14, 130, 10, 5); g.fill();
  g.fillStyle = s.fuel < 80 ? '#ff6b6b' : '#ffd23f'; rr(g, L.VW - 150, 14, Math.max(0, 130 * s.fuel / L.FUEL_MAX), 10, 5); g.fill();
  g.fillStyle = '#fff'; g.font = `600 11px ${FONT}`; g.textAlign = 'right'; g.fillText('fuel', L.VW - 156, 23);
  if (s.phase === 'landed') { g.textAlign = 'center'; g.font = `800 22px ${FONT}`; g.fillStyle = hsl(140, 80, 70); g.fillText('Touchdown!', L.VW / 2, 120); }
}

export default simGame({
  title: 'Soft Touchdown', hue: HUE, VW: L.VW, VH: L.VH, bg: '#05070f', over: 'Crashed',
  create: L.create, step: L.step, act: L.act, score: L.score,
  detail: s => `${s.landings} landing${s.landings === 1 ? '' : 's'} · crashed (${s.crashed === 'tilt' ? 'not upright' : s.crashed === 'fast' ? 'too fast' : s.crashed === 'sideways' ? 'drifting' : 'off the pad'}) on moon ${s.level}`,
  hint: touch => (touch ? 'use the buttons: turn, burn · land slowly on a flat pad' : '← → turn · ↑ or Space burns · land slowly and upright on a flat pad'),
  draw,
  keyEvent(s, code, down) {
    const b = KEY[code];
    if (!b) return null;
    const m = down ? s.keys | b : s.keys & ~b;
    return m === s.keys ? null : ['k', m];
  },
  sfx(ev, snd) {
    if (ev.type === 'land') snd.blip(660 + 120 * ev.mult, 0.18, 'triangle', 0.9, 990);
    else if (ev.type === 'crash') { snd.blip(110, 0.35, 'sawtooth', 0.9, 40); return true; }
    return false;
  },
  announce: ev => (ev.type === 'crash' ? 'Crashed.' : ev.type === 'land' ? `Landed, ${ev.pts} points.` : ev.type === 'moon' ? `Moon ${ev.level}.` : ''),
  peek: s => ({ x: s.x, y: s.y, vx: s.vx, vy: s.vy, a: s.a, fuel: s.fuel, level: s.level, landings: s.landings, phase: s.phase, keys: s.keys, crashed: s.crashed, pads: s.moon.pads.map(p => ({ ...p })) }),
});
