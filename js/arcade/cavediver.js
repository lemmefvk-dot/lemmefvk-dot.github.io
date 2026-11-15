/* ============================================================
   arcade/cavediver.js — Cave Diver for Static Arcade.

   You sink down a flooded cave with a small lamp. One button — Space,
   a click or a tap — flips the way you swim: the diver keeps drifting
   sideways toward the way it faces, so you zig-zag down the passage.
   You see only a small circle of light; the walls, the rocks and the
   dark ahead are guesses until the lamp reaches them. Air runs out
   (2 % a second), and a tank gives 45 % back: each one glows faintly
   a little farther than the lamp reaches. Rock ends the dive. The
   passage narrows with depth and the dive gets quicker. Score = depth
   in metres, higher is better.

   The world and the physics are in ./cave-sim.js (no drawing, fixed
   1/120 s steps), so the same seed is the same cave on any device and a
   replay is exact: onEnd({ replay: { v: 1, flips: [step, …] } }) holds
   the step of each press, and replay(seed, flips) in the sim gives the
   same dive. SHARED OPTIONS (index.js): ctx.seed picks the cave (Beat
   this links and the weekly challenge use it); ctx.ghost.watch plays a
   replay back by itself, otherwise a see-through diver swims your best
   run beside you; ctx.speed slows the clock (and a slowed run sets no
   best); ctx.oneButton lets any key flip.
   Reduced motion stops the bubbles and the beacon pulse; nothing flashes.
   ============================================================ */
import { surface, ownsKey, sounder, looper, prompt, FONT, clamp, coarse, randomSeed } from './kit.js';
import { WIDTH, STEP, DIVER_R, makeCave, newRun, step, metres } from './cave-sim.js';

const VIEW_H = 520;                     /* world units of depth shown, at least */
const SHELL_KEYS = new Set(['Escape', 'KeyP', 'Enter', 'NumpadEnter', 'Tab']);
const lampR = air => 92 * (0.7 + 0.3 * Math.min(1, air / 25));

export default {
  mount(el, ctx) {
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    const seed = Number.isInteger(ctx.seed) ? ctx.seed >>> 0 : randomSeed();
    const speedK = clamp(Number(ctx.speed) || 1, 0.5, 1);
    const oneButton = !!ctx.oneButton;
    const GH = ctx.ghost && ctx.ghost.data && ctx.ghost.data.v === 1 && Array.isArray(ctx.ghost.data.flips) && ctx.ghost.data.flips.length < 60000 ? ctx.ghost : null;
    const watch = !!(GH && GH.watch);
    const cave = makeCave(seed);
    const run = newRun();
    const gcave = GH && !watch ? makeCave(seed) : null, grun = gcave ? newRun() : null;
    const S = { state: 'ready', paused: false, want: 0, li: 0, gli: 0, acc: 0, dieT: 0, time: 0, readyT: 0, flash: 0, depthShown: 0 };
    const log = [];
    const sf = surface(el, 'Cave Diver', () => draw());
    const bubbles = [];
    ctx.onScore(0);

    const view = () => {
      const k = Math.min(sf.w / WIDTH, sf.h / VIEW_H);
      return { k, ox: (sf.w - WIDTH * k) / 2, vh: sf.h / k, camY: run.y - sf.h / k * 0.34 };
    };

    /* ---------------- play ---------------- */
    function flip() {
      if (S.paused || watch) return;
      if (S.state === 'ready') { S.state = 'play'; S.acc = 0; return; }
      if (S.state !== 'play') return;
      S.want = 1;
    }
    function die() {
      S.state = 'dying'; S.dieT = 0; S.flash = reduced ? 0 : 0.25;
      snd.blip(200, 0.35, 'sawtooth', 0.9, 55);
    }
    const flipsOf = (list, which) => {
      const n = which === 'g' ? grun.n : run.n;
      let i = which === 'g' ? S.gli : S.li;
      while (i < list.length && list[i] < n) i++;
      const f = i < list.length && list[i] === n;
      if (f) i++;
      if (which === 'g') S.gli = i; else S.li = i;
      return f;
    };
    function tick(dt) {
      S.time += dt;
      S.acc += dt;
      let k = 0;
      while (S.acc >= STEP - 1e-9 && k < 12 && S.state === 'play') {
        let f = false;
        if (watch) f = flipsOf(GH.data.flips, 'r');
        else if (S.want) { f = true; S.want = 0; log.push(run.n); }
        if (f) snd.blip(380, 0.05, 'triangle', 0.5, 520);
        const tanks0 = run.tanks;
        step(run, cave, f);
        if (grun && !grun.over) step(grun, gcave, flipsOf(GH.data.flips, 'g'));
        if (run.tanks > tanks0) snd.blip(660, 0.14, 'sine', 0.9, 990);
        const m = metres(run.y);
        if (m !== S.depthShown) { S.depthShown = m; ctx.onScore(m); }
        if (run.over) die();
        S.acc -= STEP; k++;
      }
      if (k >= 12) S.acc = 0;
      if (S.state === 'dying') {
        S.dieT += dt;
        if (S.dieT > 0.8) finish();
      }
      if (S.flash > 0) S.flash = Math.max(0, S.flash - dt);
      if (S.state === 'ready' && watch) { S.readyT += dt; if (S.readyT > 0.7) S.state = 'play'; }
      if (!reduced && S.state === 'play' && Math.random() < dt * 4) bubbles.push({ x: run.x + (Math.random() - 0.5) * 6, y: run.y - 6, a: 1 });
      for (const b of bubbles) { b.y -= 30 * dt; b.a -= dt * 0.8; }
      while (bubbles.length && bubbles[0].a <= 0) bubbles.shift();
    }
    function finish() {
      if (S.state === 'over') return;
      S.state = 'over';
      draw();
      const m = metres(run.y);
      const why = run.hit === 'air' ? 'You ran out of air' : run.hit === 'rock' ? 'You hit a rock' : 'You hit the wall';
      ctx.onEnd({
        score: m, won: false,
        detail: `${why} at ${m} m${run.tanks ? ` after ${run.tanks} tank${run.tanks === 1 ? '' : 's'} of air` : ''}.`,
        replay: watch ? undefined : { v: 1, flips: log.slice() },
      });
    }
    const loop = looper(raw => {
      if (S.state === 'play' || S.state === 'dying' || S.state === 'ready') tick(raw * speedK);
      draw();
      if (S.state === 'over') loop.stop();
    });

    /* ---------------- drawing ---------------- */
    function wallPath(g, V, side) {
      const y0 = V.camY - 20, y1 = V.camY + V.vh + 20;
      g.beginPath();
      const sx = side < 0 ? -2000 : WIDTH + 2000;
      g.moveTo(sx, y0);
      for (let y = y0; y <= y1; y += 14) { const e = cave.edges(Math.max(0, y)); g.lineTo(e.c + side * e.w, y); }
      g.lineTo(sx, y1);
      g.closePath();
    }
    function draw() {
      const g = sf.g;
      sf.begin();
      const V = view();
      g.fillStyle = '#04060b';
      g.fillRect(0, 0, sf.w, sf.h);
      g.save();
      g.translate(V.ox, 0);
      g.scale(V.k, V.k);
      g.translate(0, -V.camY);
      g.beginPath(); g.rect(-5000, V.camY - 40, WIDTH + 10000, V.vh + 80); g.clip();
      /* the open water */
      g.fillStyle = '#0c2433';
      g.fillRect(0, V.camY - 40, WIDTH, V.vh + 80);
      /* the rock on both sides */
      for (const side of [-1, 1]) {
        wallPath(g, V, side);
        g.fillStyle = '#2a3340'; g.fill();
        g.strokeStyle = '#4a586b'; g.lineWidth = 3; g.stroke();
      }
      const { rocks, tanks } = cave.near(V.camY - 30, V.camY + V.vh + 30);
      for (const r of rocks) {
        g.fillStyle = '#3a4656'; g.beginPath(); g.arc(r.x, r.y, r.r, 0, 7); g.fill();
        g.strokeStyle = '#566579'; g.lineWidth = 2.5; g.stroke();
        g.fillStyle = 'rgba(255,255,255,.1)'; g.beginPath(); g.arc(r.x - r.r * 0.3, r.y - r.r * 0.3, r.r * 0.45, 0, 7); g.fill();
      }
      for (const t of tanks) {
        if (run.got.includes(t.i)) continue;
        g.fillStyle = '#58f2a2'; g.fillRect(t.x - 5, t.y - 9, 10, 18);
        g.beginPath(); g.arc(t.x, t.y - 9, 5, 0, 7); g.arc(t.x, t.y + 9, 5, 0, 7); g.fill();
        g.fillStyle = '#0a2a1a'; g.fillRect(t.x - 3, t.y - 4, 6, 3);
      }
      if (grun) diver(g, grun, 0.4, '#bfe9ff');
      for (const b of bubbles) { g.strokeStyle = `rgba(190,235,255,${Math.max(0, b.a) * 0.6})`; g.lineWidth = 1.2; g.beginPath(); g.arc(b.x, b.y, 2, 0, 7); g.stroke(); }
      diver(g, run, 1, '#ffd24a');
      g.restore();
      /* the dark, with a small hole of lamplight around the diver */
      const cx = V.ox + run.x * V.k, cy = (run.y - V.camY) * V.k, R = lampR(run.air) * V.k;
      const dark = g.createRadialGradient(cx, cy, R * 0.45, cx, cy, R);
      dark.addColorStop(0, 'rgba(2,3,7,0)'); dark.addColorStop(1, 'rgba(2,3,7,0.985)');
      g.fillStyle = dark; g.fillRect(0, 0, sf.w, sf.h);
      /* an air tank shows as a faint green beacon a little beyond the lamp */
      for (const t of tanks) {
        if (run.got.includes(t.i)) continue;
        const tx = V.ox + t.x * V.k, ty = (t.y - V.camY) * V.k, d = Math.hypot(tx - cx, ty - cy);
        const a = clamp((R * 2.1 - d) / (R * 0.9), 0, 1) * (d > R * 0.9 ? 1 : 0);
        if (a <= 0) continue;
        const pulse = reduced ? 0.7 : 0.55 + 0.35 * Math.sin(S.time * 4);
        g.fillStyle = `rgba(88,242,162,${a * pulse})`; g.beginPath(); g.arc(tx, ty, Math.max(2.5, 4 * V.k), 0, 7); g.fill();
      }
      if (S.flash > 0) { g.fillStyle = `rgba(255,70,70,${S.flash * 1.4})`; g.fillRect(0, 0, sf.w, sf.h); }
      hud(g, V);
      if (S.state === 'ready') prompt(g, sf, watch ? 'Watching your best dive' : coarse() ? 'Tap to start' : 'Space, click or tap to start', watch ? '' : 'each press flips the way you swim · find the air tanks', 190, sf.h * 0.62);
      if (S.paused) prompt(g, sf, 'Paused', '', 190);
    }
    function diver(g, r, alpha, col) {
      g.save(); g.translate(r.x, r.y); g.globalAlpha = alpha;
      g.rotate(clamp(r.vx / 125, -1, 1) * 0.35);
      g.fillStyle = col; g.beginPath(); g.ellipse(0, 0, DIVER_R * 0.8, DIVER_R * 1.2, 0, 0, 7); g.fill();
      g.fillStyle = '#0b2b3a'; g.beginPath(); g.ellipse(r.dir * 2, -DIVER_R * 0.35, DIVER_R * 0.5, DIVER_R * 0.38, 0, 0, 7); g.fill();
      g.fillStyle = '#cfeeff'; g.beginPath(); g.arc(r.dir * 3, -DIVER_R * 0.4, 1.6, 0, 7); g.fill();
      g.fillStyle = col; g.fillRect(-2, DIVER_R * 0.9, 4, 5);
      g.restore();
    }
    function hud(g, V) {
      const k = Math.min(1, sf.w / 520);
      g.textBaseline = 'top';
      g.fillStyle = 'rgba(4,6,10,.7)'; g.fillRect(8, 8, 128 * Math.max(0.8, k), 46 * Math.max(0.8, k));
      g.fillStyle = '#f4f7f5'; g.textAlign = 'left'; g.font = `800 ${Math.round(22 * Math.max(0.8, k))}px ${FONT}`;
      g.fillText(`${metres(run.y)} m`, 16, 12);
      const bw = 108 * Math.max(0.8, k), by = 12 + 28 * Math.max(0.8, k);
      g.fillStyle = 'rgba(255,255,255,.15)'; g.fillRect(16, by, bw, 8);
      g.fillStyle = run.air < 25 ? '#ff6b6b' : '#58f2a2'; g.fillRect(16, by, bw * Math.max(0, run.air) / 100, 8);
      g.font = `600 ${Math.round(10 * Math.max(0.85, k))}px ${FONT}`; g.fillStyle = 'rgba(255,255,255,.6)';
      g.fillText('AIR', 16 + bw + 4, by - 1);
      if (grun) { g.textAlign = 'right'; g.fillStyle = 'rgba(190,235,255,.85)'; g.font = `700 ${Math.round(13 * Math.max(0.85, k))}px ${FONT}`; g.fillText(`ghost ${metres(grun.y)} m${grun.over ? ' (out)' : ''}`, sf.w - 12, 12); }
    }

    /* ---------------- input ---------------- */
    const onKey = e => {
      if (!ownsKey(el, e)) return;
      const mine = e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW'
        || (oneButton && !SHELL_KEYS.has(e.code) && !/^(Shift|Control|Alt|Meta|CapsLock)/.test(e.code));
      if (!mine) return;
      e.preventDefault();
      if (e.repeat) return;
      snd.wake();
      flip();
    };
    const onDown = e => { if (e.button > 0) return; e.preventDefault(); snd.wake(); flip(); };
    window.addEventListener('keydown', onKey);
    sf.cv.addEventListener('pointerdown', onDown);
    loop.start();

    return {
      stop() { loop.stop(); window.removeEventListener('keydown', onKey); sf.cv.removeEventListener('pointerdown', onDown); snd.close(); sf.destroy(); },
      pause() { S.paused = true; loop.stop(); draw(); },
      resume() { S.paused = false; if (S.state !== 'over') loop.start(); },
      peek: () => ({
        state: S.state, paused: S.paused, seed, watch, oneButton, speed: speedK,
        depth: metres(run.y), air: run.air, x: run.x, y: run.y, vx: run.vx, dir: run.dir, n: run.n, tanks: run.tanks, got: run.got.slice(), hit: run.hit, over: run.over,
        flips: log.length, log: log.slice(), ghost: grun ? { depth: metres(grun.y), over: grun.over } : null, lamp: lampR(run.air),
      }),
    };
  },
};
