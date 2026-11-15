/* ============================================================
   arcade/slab.js — Slab Tower for Static Arcade.

   A slab slides across the top of your tower. Drop it (Space, ↓, a
   click or a tap) so it lands on the slab below: what hangs over is
   cut off, so the tower narrows with every careless drop. Land dead
   centre and nothing is cut; three in a row and the slab grows back.
   Miss the tower and it is over. Rules in ./slab-logic.js, the engine
   (steps, ghost, replay, pause) in ./simkit.js.

   Same seed, same slab speeds: a Beat-this link or a ghost plays the
   same tower. All art is drawn in code. Reduced motion: the cut piece
   just vanishes, no screen shake, a still sky.
   ============================================================ */
import { rr, hsl, FONT } from './kit.js';
import { simGame } from './simkit.js';
import * as L from './slab-logic.js';

const HUE = 28;
const BASE_Y = 500;

function draw(g, s, X) {
  const ui = X.ui;
  const floors = s.floors;
  const target = Math.max(0, floors - 8);
  ui.cam = ui.cam === undefined ? target : ui.cam + (target - ui.cam) * (X.reduced ? 1 : 0.12);
  const yOf = f => BASE_Y - (f - ui.cam) * L.SLAB_H;
  const hue0 = (s.seed % 360);
  /* sky: darker the higher you are */
  const dusk = Math.min(1, floors / 60);
  if (!ui.sky || ui.skyD !== Math.round(dusk * 20)) {
    ui.skyD = Math.round(dusk * 20);
    ui.sky = g.createLinearGradient(0, 0, 0, L.VH);
    ui.sky.addColorStop(0, hsl(215 + dusk * 40, 60, 30 - dusk * 18));
    ui.sky.addColorStop(1, hsl(200 - dusk * 20, 65, 62 - dusk * 34));
  }
  g.fillStyle = ui.sky; g.fillRect(0, 0, L.VW, L.VH);
  /* ground and the first slab */
  g.fillStyle = '#2b3a2f'; g.fillRect(0, yOf(0) + L.SLAB_H, L.VW, L.VH);
  /* the ghost's height */
  if (X.G) {
    const gy = yOf(X.G.floors) + 0;
    g.strokeStyle = 'rgba(255,255,255,.55)'; g.setLineDash([8, 6]); g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, gy); g.lineTo(L.VW, gy); g.stroke(); g.setLineDash([]);
    g.fillStyle = 'rgba(255,255,255,.8)'; g.font = `700 11px ${FONT}`; g.textAlign = 'right';
    g.fillText(`ghost: floor ${X.G.floors}`, L.VW - 8, gy - 5);
  }
  const from = Math.max(0, floors - 16);
  for (let f = from; f <= floors; f++) {
    const sl = s.slabs[f], y = yOf(f);
    if (y > L.VH + 30) continue;
    g.fillStyle = hsl((hue0 + f * 9) % 360, 62, 56);
    rr(g, sl.c - sl.w / 2, y, sl.w, L.SLAB_H - 2, 4); g.fill();
    g.fillStyle = 'rgba(255,255,255,.22)'; g.fillRect(sl.c - sl.w / 2 + 3, y + 2, sl.w - 6, 4);
    if (sl.perfect) { g.strokeStyle = '#fff'; g.lineWidth = 2; rr(g, sl.c - sl.w / 2, y, sl.w, L.SLAB_H - 2, 4); g.stroke(); }
  }
  /* the sliding slab */
  if (!s.over) {
    const t = X.state === 'ready' ? 0 : s.t;
    const c = L.posAt(s, t), y = yOf(floors + 1);
    g.fillStyle = hsl((hue0 + (floors + 1) * 9) % 360, 70, 62);
    rr(g, c - s.w / 2, y, s.w, L.SLAB_H - 2, 4); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(c, y + L.SLAB_H); g.lineTo(c, yOf(floors) + 0); g.stroke();
  }
  /* pieces falling off */
  if (ui.fx) for (const p of ui.fx) {
    if (p.life <= 0) continue;
    p.vy += 900 * X.dt; p.y += p.vy * X.dt; p.life -= X.dt;
    g.globalAlpha = Math.max(0, p.life / 0.9);
    g.fillStyle = hsl((hue0 + p.f * 9) % 360, 60, 50);
    g.fillRect(p.x - p.w / 2, p.y - ui.cam * 0 + 0, p.w, L.SLAB_H - 2);
    g.globalAlpha = 1;
  }
  /* readout */
  g.textAlign = 'left'; g.fillStyle = '#fff'; g.font = `800 20px ${FONT}`;
  g.fillText(`${s.score}`, 14, 30);
  g.font = `600 12px ${FONT}`; g.fillStyle = 'rgba(255,255,255,.85)';
  g.fillText(`${floors} floor${floors === 1 ? '' : 's'}${s.streak >= 2 ? ` · ${s.streak} perfect in a row` : ''}`, 14, 48);
}

export default simGame({
  title: 'Slab Tower', hue: HUE, VW: L.VW, VH: L.VH, bg: '#101826', over: 'Toppled', consumeFirst: true,
  create: L.create, step: L.step, act: L.act, score: L.score,
  detail: s => `${s.floors} floor${s.floors === 1 ? '' : 's'} · ${s.perfects} perfect drop${s.perfects === 1 ? '' : 's'}`,
  hint: touch => (touch ? 'tap to drop the slab · line it up with the one below' : 'Space, ↓ or a click drops the slab · line it up with the one below'),
  draw,
  keyEvent: (s, code, down) => (down && (code === 'Space' || code === 'ArrowDown' || code === 'KeyS') ? ['d'] : null),
  pointerEvent: (s, kind) => (kind === 'down' ? ['d'] : null),
  sfx(ev, snd, ui) {
    if (ev.type === 'drop') snd.blip(ev.perfect ? 880 + 80 * Math.min(6, ev.streak) : 330, 0.08, 'triangle', 0.8);
    else if (ev.type === 'cut') {
      if (!ui.fx) ui.fx = Array.from({ length: 6 }, () => ({ x: 0, y: 0, w: 0, f: 0, vy: 0, life: 0 }));
      const p = ui.fx.find(q => q.life <= 0) || ui.fx[0];
      /* y where the slab landed on the screen: 500 - (f - cam) * 22 */
      p.x = ev.c; p.w = ev.w; p.f = ev.f; p.vy = 0; p.life = 0.9; p.y = BASE_Y - (ev.f - (ui.cam || 0)) * L.SLAB_H;
    } else if (ev.type === 'miss') { snd.blip(120, 0.3, 'sawtooth', 0.8, 50); return true; }
    return false;
  },
  announce: ev => (ev.type === 'miss' ? 'Missed the tower.' : ev.type === 'drop' && ev.perfect ? 'Perfect.' : ''),
  peek: (s, ui) => ({ floors: s.floors, perfects: s.perfects, streak: s.streak, width: s.w, c: L.posAt(s, s.t), topC: s.slabs[s.slabs.length - 1].c, v: s.cur.v, lo: L.LO, hi: L.HI, cam: ui.cam || 0 }),
});
