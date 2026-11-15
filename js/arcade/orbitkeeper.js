/* ============================================================
   arcade/orbitkeeper.js — Orbit Keeper for Static Arcade.

   You pilot a small ship round a planet. One button — Space, a click
   or a tap — sends it to the next ring (outward, and from the outer
   ring back in); the inner rings are quicker. Fuel pods drift on the
   rings: fly through them for fuel and points. Debris appears as a faint
   outline for a second before it turns solid and then circles on, some
   of it backwards; a hit costs one of three hulls. The ship crosses
   between rings in about a third of a second, and is not on any ring
   while it does. Score = whole seconds flown + 10 a pod, higher is
   better; the run ends when the fuel or the hulls are gone.

   The world and the physics are in ./orbit-sim.js (no drawing, fixed
   1/120 s steps): the same seed is the same flight plan on any device,
   and a replay is exact — onEnd({ replay: { v: 1, taps: [step, …] } }) is
   the step of each press, and replay(seed, taps) in the sim gives the
   same flight. SHARED OPTIONS (index.js): ctx.seed picks the plan (Beat
   this links and the weekly challenge use it); ctx.ghost.watch plays a
   replay back by itself, otherwise a see-through ship flies your best
   run beside you; ctx.speed slows the clock (and a slowed run sets no
   best); ctx.oneButton lets any key tap.
   Reduced motion: the warning outlines stay still and nothing flashes.
   ============================================================ */
import { surface, ownsKey, sounder, looper, prompt, FONT, clamp, coarse, randomSeed, rng } from './kit.js';
import { STEP, RINGS, PLANET_R, SHIP_R, HULLS, WARN, makeField, newRun, step, posOf, timeOf } from './orbit-sim.js';

const SHELL_KEYS = new Set(['Escape', 'KeyP', 'Enter', 'NumpadEnter', 'Tab']);
const SPAN = RINGS[2] + 26;

export default {
  mount(el, ctx) {
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    const seed = Number.isInteger(ctx.seed) ? ctx.seed >>> 0 : randomSeed();
    const speedK = clamp(Number(ctx.speed) || 1, 0.5, 1);
    const oneButton = !!ctx.oneButton;
    const GH = ctx.ghost && ctx.ghost.data && ctx.ghost.data.v === 1 && Array.isArray(ctx.ghost.data.taps) && ctx.ghost.data.taps.length < 60000 ? ctx.ghost : null;
    const watch = !!(GH && GH.watch);
    const field = makeField(seed);
    const run = newRun();
    const grun = GH && !watch ? newRun() : null;
    const S = { state: 'ready', paused: false, want: 0, li: 0, gli: 0, acc: 0, dieT: 0, time: 0, readyT: 0, shown: 0 };
    const log = [];
    const stars = (() => { const r = rng(7); return Array.from({ length: 90 }, () => ({ x: r() * 2 - 1, y: r() * 2 - 1, s: r() * 1.4 + 0.3, p: r() * 6 })); })();
    const sf = surface(el, 'Orbit Keeper', () => draw());
    ctx.onScore(0);
    const view = () => { const k = Math.min(sf.w, sf.h) / (SPAN * 2); return { k, cx: sf.w / 2, cy: sf.h / 2 }; };

    /* ---------------- play ---------------- */
    function tap() {
      if (S.paused || watch) return;
      if (S.state === 'ready') { S.state = 'play'; S.acc = 0; return; }
      if (S.state !== 'play') return;
      S.want = 1;
    }
    const tapsOf = (list, r, which) => {
      let i = which === 'g' ? S.gli : S.li;
      while (i < list.length && list[i] < r.n) i++;
      const f = i < list.length && list[i] === r.n;
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
        if (watch) f = tapsOf(GH.data.taps, run, 'r');
        else if (S.want) { f = true; S.want = 0; log.push(run.n); }
        if (f) snd.blip(300, 0.06, 'triangle', 0.5, 480);
        const pods0 = run.pods, hits0 = run.hits;
        step(run, field, f);
        if (grun && !grun.over) step(grun, field, tapsOf(GH.data.taps, grun, 'g'));
        if (run.pods > pods0) snd.blip(700, 0.12, 'sine', 0.9, 1000);
        if (run.hits > hits0) snd.blip(160, 0.25, 'sawtooth', 0.9, 60);
        if (run.score !== S.shown) { S.shown = run.score; ctx.onScore(run.score); }
        if (run.over) { S.state = 'dying'; S.dieT = 0; snd.blip(120, 0.4, 'sawtooth', 0.9, 40); }
        S.acc -= STEP; k++;
      }
      if (k >= 12) S.acc = 0;
      if (S.state === 'dying') { S.dieT += dt; if (S.dieT > 0.8) finish(); }
      if (S.state === 'ready' && watch) { S.readyT += dt; if (S.readyT > 0.7) S.state = 'play'; }
    }
    function finish() {
      if (S.state === 'over') return;
      S.state = 'over';
      draw();
      const secs = Math.floor(timeOf(run));
      const why = run.why === 'fuel' ? 'Out of fuel' : 'The hull gave way';
      ctx.onEnd({
        score: run.score, won: false,
        detail: `${why} after ${secs} s with ${run.pods} fuel pod${run.pods === 1 ? '' : 's'} (${secs} + ${run.pods * 10}).`,
        replay: watch ? undefined : { v: 1, taps: log.slice() },
      });
    }
    const loop = looper(raw => {
      if (S.state === 'play' || S.state === 'dying' || S.state === 'ready') tick(raw * speedK);
      draw();
      if (S.state === 'over') loop.stop();
    });

    /* ---------------- drawing ---------------- */
    function debris(g, o, x, y, a) {
      g.save(); g.translate(x, y); g.rotate(o.shape * 0.37 + (reduced ? 0 : S.time * 0.8));
      g.beginPath();
      for (let i = 0; i < 7; i++) { const ang = i / 7 * Math.PI * 2, rad = o.r * (0.7 + ((o.shape >> i) & 3) * 0.15); g.lineTo(Math.cos(ang) * rad, Math.sin(ang) * rad); }
      g.closePath(); g.globalAlpha = a;
      g.fillStyle = '#9a8f86'; g.fill(); g.strokeStyle = '#d8cfc6'; g.lineWidth = 1.5; g.stroke();
      g.restore();
    }
    function shipAt(g, r, alpha, col) {
      const x = Math.cos(r.th) * r.r, y = Math.sin(r.th) * r.r;
      g.save(); g.translate(x, y); g.rotate(r.th + Math.PI / 2); g.globalAlpha = alpha;
      g.fillStyle = col; g.beginPath(); g.moveTo(0, -SHIP_R * 1.5); g.lineTo(SHIP_R, SHIP_R); g.lineTo(0, SHIP_R * 0.45); g.lineTo(-SHIP_R, SHIP_R); g.closePath(); g.fill();
      g.fillStyle = '#0a2a3a'; g.beginPath(); g.arc(0, -SHIP_R * 0.1, SHIP_R * 0.3, 0, 7); g.fill();
      g.restore();
    }
    function draw() {
      const g = sf.g;
      sf.begin();
      const V = view(), time = timeOf(run);
      g.fillStyle = '#050712'; g.fillRect(0, 0, sf.w, sf.h);
      for (const s of stars) { g.fillStyle = `rgba(255,255,255,${reduced ? 0.5 : 0.35 + 0.3 * Math.sin(S.time * 1.5 + s.p)})`; g.fillRect(V.cx + s.x * sf.w / 2, V.cy + s.y * sf.h / 2, s.s, s.s); }
      g.save(); g.translate(V.cx, V.cy); g.scale(V.k, V.k);
      g.lineWidth = 1.2 / V.k * 1.4;
      RINGS.forEach((rad, i) => { g.strokeStyle = i === run.ring && run.r === rad ? 'rgba(160,215,255,.55)' : 'rgba(255,255,255,.16)'; g.beginPath(); g.arc(0, 0, rad, 0, 7); g.stroke(); });
      const pg = g.createRadialGradient(-8, -8, 2, 0, 0, PLANET_R);
      pg.addColorStop(0, '#9fd8ff'); pg.addColorStop(1, '#2a5f9e');
      g.fillStyle = pg; g.beginPath(); g.arc(0, 0, PLANET_R, 0, 7); g.fill();
      for (const o of field.at(time)) {
        if (run.gone.includes(o.id)) continue;
        const [x, y] = posOf(o, time);
        if (o.kind === 'pod') {
          const a = clamp((time - o.born) / 0.3, 0, 1);
          g.save(); g.translate(x, y); g.globalAlpha = a;
          g.shadowColor = '#58f2a2'; g.shadowBlur = reduced ? 0 : 10; g.fillStyle = '#58f2a2'; g.beginPath(); g.arc(0, 0, o.r, 0, 7); g.fill(); g.shadowBlur = 0;
          g.fillStyle = '#0a2a1a'; g.fillRect(-1.5, -4, 3, 8);
          g.restore();
        } else if (time < o.solid) {
          /* a warning: where debris will be, drawn as a still dashed outline */
          const k = (time - o.born) / WARN;
          g.save(); g.translate(x, y); g.strokeStyle = `rgba(255,120,110,${reduced ? 0.7 : 0.35 + 0.4 * Math.abs(Math.sin(S.time * 8))})`; g.lineWidth = 1.6 / V.k * 1.4; g.setLineDash([3, 3]);
          g.beginPath(); g.arc(0, 0, o.r + 4 * (1 - k), 0, 7); g.stroke(); g.restore();
        } else debris(g, o, x, y, 1);
      }
      if (grun) shipAt(g, grun, grun.over ? 0.12 : 0.4, '#bfe9ff');
      const blink = run.inv > 0 && !reduced && Math.floor(S.time * 12) % 2 === 0;
      if (S.state !== 'dying' || Math.floor(S.dieT * 10) % 2 === 0) shipAt(g, run, blink ? 0.35 : 1, run.inv > 0 ? '#ffb3a6' : '#ffffff');
      g.restore();
      hud(g);
      if (S.state === 'ready') prompt(g, sf, watch ? 'Watching your best flight' : coarse() ? 'Tap to start' : 'Space, click or tap to start', watch ? '' : 'each press moves you to the next ring · gather the green fuel pods', 190, sf.h * 0.9);
      if (S.paused) prompt(g, sf, 'Paused', '', 190);
    }
    function hud(g) {
      const k = Math.max(0.8, Math.min(1, sf.w / 520));
      g.textBaseline = 'top'; g.textAlign = 'left';
      g.fillStyle = 'rgba(4,6,10,.7)'; g.fillRect(8, 8, 134 * k, 56 * k);
      g.fillStyle = '#f4f7f5'; g.font = `800 ${Math.round(22 * k)}px ${FONT}`; g.fillText(String(run.score), 16, 11);
      const bw = 112 * k, by = 11 + 28 * k;
      g.fillStyle = 'rgba(255,255,255,.15)'; g.fillRect(16, by, bw, 8);
      g.fillStyle = run.fuel < 25 ? '#ff6b6b' : '#58f2a2'; g.fillRect(16, by, bw * Math.max(0, run.fuel) / 100, 8);
      for (let i = 0; i < HULLS; i++) { g.fillStyle = i < run.hull ? '#ffd24a' : 'rgba(255,255,255,.2)'; g.fillRect(16 + i * 16 * k, by + 13 * k, 12 * k, 6 * k); }
      if (grun) { g.textAlign = 'right'; g.fillStyle = 'rgba(190,235,255,.85)'; g.font = `700 ${Math.round(13 * k)}px ${FONT}`; g.fillText(`ghost ${grun.score}${grun.over ? ' (out)' : ''}`, sf.w - 12, 12); }
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
      tap();
    };
    const onDown = e => { if (e.button > 0) return; e.preventDefault(); snd.wake(); tap(); };
    window.addEventListener('keydown', onKey);
    sf.cv.addEventListener('pointerdown', onDown);
    loop.start();

    return {
      stop() { loop.stop(); window.removeEventListener('keydown', onKey); sf.cv.removeEventListener('pointerdown', onDown); snd.close(); sf.destroy(); },
      pause() { S.paused = true; loop.stop(); draw(); },
      resume() { S.paused = false; if (S.state !== 'over') loop.start(); },
      peek: () => {
        const time = timeOf(run);
        return {
          state: S.state, paused: S.paused, seed, watch, oneButton, speed: speedK,
          score: run.score, fuel: run.fuel, hull: run.hull, pods: run.pods, hits: run.hits, ring: run.ring, out: run.out, r: run.r, th: run.th, n: run.n, time, over: run.over, why: run.why, inv: run.inv,
          taps: log.length, log: log.slice(), ghost: grun ? { score: grun.score, over: grun.over } : null,
          objs: field.at(time).filter(o => !run.gone.includes(o.id)).map(o => { const [x, y, th] = posOf(o, time); return { id: o.id, kind: o.kind, ring: o.ring, x, y, th, solid: time >= o.solid, w: o.w, r: o.r }; }),
        };
      },
    };
  },
};
