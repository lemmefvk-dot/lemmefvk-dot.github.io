/* ============================================================
   arcade/skyguard.js — Sky Guard for Static Arcade.

   Rockets rain down on six towns and three guns. Click or tap where a
   shell should burst (the nearest gun with shells left fires it), or
   steer the cross-hair with the arrows and press Space. Burst a ball
   of fire in a rocket's path: it grows and fades, and any rocket
   inside it is destroyed. Waves get faster and some rockets split in
   two. Rules in ./skyguard-logic.js, the engine in ./simkit.js.

   Same seed, same waves: a ghost's shells burst beside yours. All art
   is drawn in code. Reduced motion: no screen shake, no flicker in the
   fire.
   ============================================================ */
import { hsl, FONT, rng } from './kit.js';
import { simGame } from './simkit.js';
import * as L from './skyguard-logic.js';

const HUE = 8;
const STARS = (() => { const r = rng(9); return Array.from({ length: 40 }, () => [r() * L.VW, r() * 260, 0.6 + r()]); })();

function draw(g, s, X) {
  const ui = X.ui;
  if (ui.cx === undefined) { ui.cx = 320; ui.cy = 170; }
  if (ui.dx || ui.dy) {
    ui.cx = Math.max(0, Math.min(L.VW, ui.cx + (ui.dx || 0) * 260 * (X.dt || 0)));
    ui.cy = Math.max(0, Math.min(L.GROUND - 20, ui.cy + (ui.dy || 0) * 260 * (X.dt || 0)));
  }
  const bg = ui.bg || (ui.bg = (() => { const q = g.createLinearGradient(0, 0, 0, L.VH); q.addColorStop(0, '#080c1c'); q.addColorStop(1, '#2a2147'); return q; })());
  g.fillStyle = bg; g.fillRect(0, 0, L.VW, L.VH);
  g.fillStyle = '#fff';
  for (const st of STARS) { g.globalAlpha = 0.3 + st[2] * 0.2; g.fillRect(st[0], st[1], st[2], st[2]); }
  g.globalAlpha = 1;
  g.fillStyle = '#2d2a3a'; g.fillRect(0, L.GROUND, L.VW, L.VH - L.GROUND);
  /* towns and guns */
  for (let i = 0; i < L.TARGETS.length; i++) {
    const T = L.TARGETS[i], ok = s.alive[i];
    if (T.kind === 'town') {
      if (ok) {
        g.fillStyle = '#6fd3ff'; g.fillRect(T.x - 18, L.GROUND - 14, 10, 14); g.fillRect(T.x - 6, L.GROUND - 24, 12, 24); g.fillRect(T.x + 8, L.GROUND - 10, 10, 10);
        g.fillStyle = '#ffe28a'; g.fillRect(T.x - 3, L.GROUND - 19, 3, 3); g.fillRect(T.x + 2, L.GROUND - 12, 3, 3);
      } else { g.fillStyle = '#4a4660'; g.fillRect(T.x - 16, L.GROUND - 4, 32, 4); }
    } else if (ok) {
      g.fillStyle = '#c9cfe0'; g.beginPath(); g.moveTo(T.x - 16, L.GROUND); g.lineTo(T.x - 10, L.GROUND - 12); g.lineTo(T.x + 10, L.GROUND - 12); g.lineTo(T.x + 16, L.GROUND); g.closePath(); g.fill();
      g.fillRect(T.x - 2, L.GROUND - 22, 4, 12);
      g.fillStyle = s.ammo[i] > 2 ? '#ffd23f' : '#ff6b6b'; g.font = `700 10px ${FONT}`; g.textAlign = 'center'; g.fillText(String(s.ammo[i]), T.x, L.GROUND + 14);
    } else { g.fillStyle = '#4a4660'; g.fillRect(T.x - 14, L.GROUND - 4, 28, 4); }
  }
  /* rockets: a thin trail behind a bright head */
  g.lineWidth = 1.5;
  for (let i = 0; i < s.rockets.length; i++) {
    const r = s.rockets[i];
    if (!r.on) continue;
    const k = 40;
    g.strokeStyle = 'rgba(255,120,100,.55)'; g.beginPath(); g.moveTo(r.x - r.vx * k, r.y - r.vy * k); g.lineTo(r.x, r.y); g.stroke();
    g.fillStyle = r.split ? '#ffb347' : '#ff6b5e'; g.fillRect(r.x - 2, r.y - 2, 4, 4);
  }
  g.strokeStyle = 'rgba(180,230,255,.6)';
  for (let i = 0; i < s.shells.length; i++) {
    const sh = s.shells[i];
    if (!sh.on) continue;
    g.beginPath(); g.moveTo(sh.x - sh.vx * 6, sh.y - sh.vy * 6); g.lineTo(sh.x, sh.y); g.stroke();
    g.strokeRect(sh.tx - 3, sh.ty - 3, 6, 6);
  }
  /* fire */
  for (let i = 0; i < s.fires.length; i++) {
    const f = s.fires[i];
    if (!f.on) continue;
    const rad = L.radius(f);
    g.globalAlpha = 0.75;
    g.fillStyle = f.hostile ? '#ff7a3c' : (X.reduced || f.age % 4 < 2 ? '#fff1b0' : '#ffd23f');
    g.beginPath(); g.arc(f.x, f.y, rad, 0, 6.2832); g.fill();
    g.globalAlpha = 1;
  }
  /* the ghost's bursts */
  if (X.G) for (let i = 0; i < X.G.fires.length; i++) {
    const f = X.G.fires[i];
    if (!f.on || f.hostile) continue;
    g.strokeStyle = 'rgba(255,255,255,.45)'; g.lineWidth = 1.5; g.beginPath(); g.arc(f.x, f.y, L.radius(f), 0, 6.2832); g.stroke();
  }
  /* the cross-hair */
  if (!s.over) {
    g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(ui.cx, ui.cy, 8, 0, 6.2832); g.moveTo(ui.cx - 14, ui.cy); g.lineTo(ui.cx + 14, ui.cy); g.moveTo(ui.cx, ui.cy - 14); g.lineTo(ui.cx, ui.cy + 14); g.stroke();
  }
  g.textAlign = 'left'; g.fillStyle = '#fff'; g.font = `800 20px ${FONT}`; g.fillText(String(s.score), 14, 28);
  g.font = `600 12px ${FONT}`; g.fillStyle = 'rgba(255,255,255,.8)'; g.fillText(`Wave ${s.wave}`, 14, 46);
  if (s.phase === 'gap') { g.textAlign = 'center'; g.font = `800 20px ${FONT}`; g.fillStyle = hsl(140, 80, 72); g.fillText(`Wave ${s.wave} held`, L.VW / 2, 120); }
}

export default simGame({
  title: 'Sky Guard', hue: HUE, VW: L.VW, VH: L.VH, bg: '#080c1c', over: 'The towns have fallen', consumeFirst: false,
  create: L.create, step: L.step, act: L.act, score: L.score,
  detail: s => `Wave ${s.wave} · ${s.kills} rocket${s.kills === 1 ? '' : 's'} shot down with ${s.shots} shell${s.shots === 1 ? '' : 's'} · ${s.lost} target${s.lost === 1 ? '' : 's'} lost`,
  hint: touch => (touch ? 'tap where a shell should burst · burst in a rocket’s path' : 'click where a shell should burst, or arrows and Space · burst in a rocket’s path'),
  draw,
  uiKey(code, down, ui) {
    const v = down ? 1 : 0;
    if (code === 'ArrowLeft' || code === 'KeyA') { ui.dx = v ? -1 : (ui.dx === -1 ? 0 : ui.dx); return true; }
    if (code === 'ArrowRight' || code === 'KeyD') { ui.dx = v ? 1 : (ui.dx === 1 ? 0 : ui.dx); return true; }
    if (code === 'ArrowUp' || code === 'KeyW') { ui.dy = v ? -1 : (ui.dy === -1 ? 0 : ui.dy); return true; }
    if (code === 'ArrowDown' || code === 'KeyS') { ui.dy = v ? 1 : (ui.dy === 1 ? 0 : ui.dy); return true; }
    return false;
  },
  keyEvent: (s, code, down, ui) => (down && code === 'Space' ? ['f', Math.round(ui.cx === undefined ? 320 : ui.cx), Math.round(ui.cy === undefined ? 170 : ui.cy)] : null),
  pointerEvent(s, kind, x, y, ui) {
    ui.cx = x; ui.cy = Math.min(L.GROUND - 20, y);
    return kind === 'down' ? ['f', Math.round(x), Math.round(ui.cy)] : null;
  },
  sfx(ev, snd) {
    if (ev.type === 'shot') snd.blip(500, 0.08, 'square', 0.5, 800);
    else if (ev.type === 'kill') snd.blip(260, 0.1, 'sawtooth', 0.6, 120);
    else if (ev.type === 'lost') { snd.blip(90, 0.3, 'sawtooth', 0.9, 40); return true; }
    else if (ev.type === 'cleared') snd.blip(780, 0.2, 'triangle', 0.9, 1100);
    return false;
  },
  announce: ev => (ev.type === 'lost' ? (ev.target < 3 ? 'A gun was destroyed.' : 'A town was destroyed.') : ev.type === 'cleared' ? `Wave ${ev.n} held, ${ev.bonus} bonus.` : ev.type === 'over' ? 'Every town has fallen.' : ''),
  peek: (s, ui) => ({
    wave: s.wave, phase: s.phase, towns: L.towns(s), alive: s.alive.slice(), ammo: s.ammo.slice(), kills: s.kills, shots: s.shots, lost: s.lost,
    rockets: s.rockets.filter(r => r.on).map(r => ({ x: r.x, y: r.y, vx: r.vx, vy: r.vy })), fires: L.count(s.fires), cx: ui.cx === undefined ? 320 : ui.cx, cy: ui.cy === undefined ? 170 : ui.cy,
  }),
});
