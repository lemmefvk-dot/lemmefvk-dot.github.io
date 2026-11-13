/* ============================================================
   arcade/moles.js — Whack-a-Mole for Static Arcade.

   Nine holes in a 3 x 3 lawn and a 30-second round. Critters pop
   up; whack them before they duck back down.

     Mole         +10   the usual
     Golden mole  +30   quick, and rare
     Spike hog    -15   not one to whack (the score never drops below 0)

   · Three speeds: Slow, Medium and Fast, chosen before the round
     starts (click one, or press ← / →). The round gets a little
     quicker as the clock runs down.
   · Mouse or touch: press a hole. Keyboard: the number keys 1-9 are
     the holes in reading order (1 2 3 along the top); on a numeric
     keypad the keys sit where the holes do, 7 8 9 along the top.
   · Space / Enter (or pressing anywhere off the speed buttons) starts.
   · Reduced motion: critters appear and vanish without sliding, and
     nothing bobs or flashes.
   Test hook (el.arcadeHook): inert unless called; see the end of mount().
   ============================================================ */
import { clamp, hsl, FONT, coarse, fitView, surface, ownsKey, sounder, looper, rr, prompt } from './kit.js';

const VW = 480, VH = 540;
const GRID_X = 30, GRID_Y = 118, CELL = 140;
const ROUND = 30;
const SPEEDS = {
  slow:   { name: 'Slow',   spawn: 1.15, up: 1.6, max: 2 },
  medium: { name: 'Medium', spawn: 0.8,  up: 1.15, max: 3 },
  fast:   { name: 'Fast',   spawn: 0.55, up: 0.8,  max: 3 },
};
const SPEED_IDS = Object.keys(SPEEDS);
const KINDS = {
  mole: { pts: 10, name: 'Mole', mult: 1 },
  gold: { pts: 30, name: 'Golden mole', mult: 0.62 },
  hog:  { pts: -15, name: 'Spike hog', mult: 1 },
};
const BTN = SPEED_IDS.map((id, i) => ({ id, x: 60 + i * 130, y: 62, w: 120, h: 34 }));
const holeXY = i => ({ x: GRID_X + (i % 3) * CELL + CELL / 2, y: GRID_Y + Math.floor(i / 3) * CELL + CELL / 2 + 22 });
/* a numeric keypad is laid out with 7 8 9 on top: map it to holes spatially */
const PAD = { Numpad7: 0, Numpad8: 1, Numpad9: 2, Numpad4: 3, Numpad5: 4, Numpad6: 5, Numpad1: 6, Numpad2: 7, Numpad3: 8 };

export default {
  mount(el, ctx) {
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    const S = {
      state: 'ready',                    /* ready | play | over */
      paused: false, manual: false, auto: true,
      speed: 'medium', score: 0, left: ROUND, time: 0,
      crit: [], spawnT: 0.5, hits: { mole: 0, gold: 0, hog: 0 }, misses: 0,
      pops: [], swing: null, sel: 0,
    };
    const sf = surface(el, 'Whack-a-Mole lawn', () => draw());
    let V = fitView(sf, VW, VH);
    ctx.onScore(0);

    /* ------------------------------ rules ------------------------------ */
    const sp = () => SPEEDS[S.speed];
    const ramp = () => 1 - 0.28 * clamp((ROUND - S.left) / ROUND, 0, 1);
    const critAt = h => S.crit.find(c => c.hole === h && c.state === 'up');

    function start() {
      if (S.state !== 'ready') return;
      S.state = 'play'; S.left = ROUND; S.spawnT = 0.4;
    }
    function spawn(hole, kind, life) {
      if (critAt(hole) || S.crit.some(c => c.hole === hole)) return false;
      const k = KINDS[kind];
      S.crit.push({ hole, kind, t: 0, life: life ?? sp().up * k.mult * ramp(), state: 'up', hitT: 0 });
      return true;
    }
    function randomSpawn() {
      const free = [...Array(9).keys()].filter(h => !S.crit.some(c => c.hole === h));
      if (!free.length) return;
      const hole = free[Math.floor(Math.random() * free.length)];
      const r = Math.random();
      spawn(hole, r < 0.14 ? 'gold' : r < 0.34 ? 'hog' : 'mole');
    }
    function whack(h) {
      if (S.paused || S.state !== 'play') return;
      const { x, y } = holeXY(h);
      S.swing = { hole: h, t: 0.16 };
      const c = critAt(h);
      if (!c) { S.misses++; snd.blip(120, 0.06, 'triangle', 0.5); return; }
      c.state = 'hit'; c.hitT = 0;
      const k = KINDS[c.kind];
      const before = S.score;
      S.score = Math.max(0, S.score + k.pts);
      S.hits[c.kind]++;
      ctx.onScore(S.score);
      S.pops.push({ text: k.pts > 0 ? `+${k.pts}` : `${k.pts}`, x, y: y - 70, t: 0.8, hue: k.pts > 0 ? (c.kind === 'gold' ? 48 : 140) : 0 });
      if (k.pts > 0) snd.blip(c.kind === 'gold' ? 880 : 520, 0.09, 'square', 0.8, c.kind === 'gold' ? 1320 : 760);
      else snd.blip(160, 0.25, 'sawtooth', 0.9, 60);
      return before;
    }

    function update(dt) {
      S.time += dt;
      for (const q of S.pops) { q.t -= dt; if (!reduced) q.y -= dt * 40; }
      S.pops = S.pops.filter(q => q.t > 0);
      if (S.swing && (S.swing.t -= dt) <= 0) S.swing = null;
      if (S.state !== 'play') return;
      S.left -= dt;
      for (const c of S.crit) {
        if (c.state === 'up') { c.t += dt; if (c.t >= c.life) c.state = 'gone'; }
        else if (c.state === 'hit') { c.hitT += dt; if (c.hitT > 0.28) c.state = 'gone'; }
      }
      S.crit = S.crit.filter(c => c.state !== 'gone');
      if (S.left <= 0) {
        S.left = 0; S.state = 'over'; S.crit = [];
        ctx.onEnd({ score: S.score, won: false, detail: `${S.hits.mole + S.hits.gold} critter${S.hits.mole + S.hits.gold === 1 ? '' : 's'} whacked${S.hits.gold ? ` (${S.hits.gold} golden)` : ''}${S.hits.hog ? ` · ${S.hits.hog} spike hog${S.hits.hog === 1 ? '' : 's'} hit` : ''} · ${sp().name}` });
        return;
      }
      if (S.auto) {
        S.spawnT -= dt;
        if (S.spawnT <= 0) {
          if (S.crit.filter(c => c.state === 'up').length < sp().max) randomSpawn();
          S.spawnT = sp().spawn * ramp() * (0.7 + Math.random() * 0.6);
        }
      }
    }
    const loop = looper(dt => {
      if (!S.manual) update(dt);
      draw();
      if (S.state === 'over' && !S.pops.length) loop.stop();
    });

    /* ------------------------------ drawing ------------------------------ */
    function critter(g, c, x, y) {
      let h = 1;
      if (c.state === 'hit') h = reduced ? 0 : 1 - clamp(c.hitT / 0.28, 0, 1);
      else if (!reduced) h = Math.min(clamp(c.t / 0.14, 0, 1), clamp((c.life - c.t) / 0.18, 0, 1));
      if (h <= 0.01) return;
      const dead = c.state === 'hit';
      g.save();
      g.beginPath(); g.rect(x - 70, y - 120, 140, 120 + 4); g.clip();
      g.translate(x, y + (1 - h) * 84 + (dead && !reduced ? 4 : 0));
      const squash = dead ? 0.82 : 1;
      g.scale(1.0, squash);
      const gold = c.kind === 'gold', hog = c.kind === 'hog';
      const body = hog ? hsl(280, 22, 34) : gold ? hsl(46, 95, 56) : hsl(26, 45, 36);
      const belly = hog ? hsl(280, 20, 50) : gold ? hsl(50, 100, 78) : hsl(28, 40, 56);
      if (hog) {                                          /* spikes behind the head */
        g.fillStyle = hsl(285, 25, 24);
        for (let i = -3; i <= 3; i++) { g.beginPath(); g.moveTo(i * 12 - 7, -54); g.lineTo(i * 12 + Math.sin(i) * 3, -84 + Math.abs(i) * 6); g.lineTo(i * 12 + 7, -54); g.fill(); }
      }
      g.fillStyle = body; g.beginPath(); g.ellipse(0, -34, 40, 46, 0, Math.PI, 0); g.rect(-40, -34, 80, 40); g.fill();
      g.fillStyle = belly; g.beginPath(); g.ellipse(0, -14, 24, 24, 0, 0, Math.PI * 2); g.fill();
      /* paws */
      g.fillStyle = body; g.beginPath(); g.ellipse(-30, -6, 10, 8, 0, 0, 7); g.ellipse(30, -6, 10, 8, 0, 0, 7); g.fill();
      g.strokeStyle = hsl(40, 30, 85); g.lineWidth = 2;
      for (const s of [-1, 1]) for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(s * 30 + (i - 1) * 5, -10); g.lineTo(s * 30 + (i - 1) * 5, -2); g.stroke(); }
      /* face */
      g.fillStyle = hog ? hsl(350, 70, 62) : hsl(350, 80, 74);
      g.beginPath(); g.arc(0, -42, hog ? 8 : 7, 0, 7); g.fill();
      if (dead) {
        g.strokeStyle = '#201008'; g.lineWidth = 2.5;
        for (const s of [-1, 1]) { g.beginPath(); g.moveTo(s * 15 - 5, -66); g.lineTo(s * 15 + 5, -56); g.moveTo(s * 15 + 5, -66); g.lineTo(s * 15 - 5, -56); g.stroke(); }
      } else {
        g.fillStyle = '#fff'; g.beginPath(); g.arc(-14, -61, 6.5, 0, 7); g.arc(14, -61, 6.5, 0, 7); g.fill();
        g.fillStyle = '#1a1008'; g.beginPath(); g.arc(-13, -60, 3.2, 0, 7); g.arc(13, -60, 3.2, 0, 7); g.fill();
        if (hog) { g.strokeStyle = '#1a1008'; g.lineWidth = 3; g.beginPath(); g.moveTo(-22, -72); g.lineTo(-6, -66); g.moveTo(22, -72); g.lineTo(6, -66); g.stroke(); }
      }
      if (gold) { g.fillStyle = hsl(48, 100, 88); for (const [sx, sy] of [[-30, -88], [28, -80], [0, -98]]) { g.beginPath(); g.moveTo(sx, sy - 6); g.lineTo(sx + 2, sy - 2); g.lineTo(sx + 6, sy); g.lineTo(sx + 2, sy + 2); g.lineTo(sx, sy + 6); g.lineTo(sx - 2, sy + 2); g.lineTo(sx - 6, sy); g.lineTo(sx - 2, sy - 2); g.closePath(); g.fill(); } }
      if (!dead && !hog) { g.fillStyle = '#fff'; g.fillRect(-4, -34, 3.5, 6); g.fillRect(0.5, -34, 3.5, 6); }
      g.restore();
    }
    function mallet(g, x, y, t) {
      const k = clamp(t / 0.16, 0, 1), ang = -0.9 + (1 - k) * 0.9 * (reduced ? 0 : 1);
      g.save(); g.translate(x + 34, y - 74); g.rotate(reduced ? -0.2 : ang);
      g.fillStyle = hsl(28, 50, 40); g.fillRect(-4, 0, 8, 70);
      g.fillStyle = hsl(14, 60, 46); rr(g, -22, -20, 44, 28, 6); g.fill();
      g.fillStyle = hsl(14, 70, 64); g.fillRect(-22, -14, 44, 4);
      g.restore();
    }
    function draw() {
      const g = sf.g;
      sf.begin();
      V = fitView(sf, VW, VH, 6);
      g.fillStyle = '#04060a'; g.fillRect(0, 0, sf.w, sf.h);
      g.save();
      g.translate(V.ox, V.oy); g.scale(V.s, V.s);
      g.beginPath(); g.rect(0, 0, VW, VH); g.clip();
      const lawn = g.createLinearGradient(0, 0, 0, VH);
      lawn.addColorStop(0, hsl(118, 45, 26)); lawn.addColorStop(1, hsl(105, 50, 18));
      g.fillStyle = lawn; g.fillRect(0, 0, VW, VH);
      g.fillStyle = 'rgba(255,255,255,.05)';
      for (let i = 0; i < 40; i++) g.fillRect((i * 97) % VW, 112 + (i * 61) % (VH - 120), 3, 8);

      /* header: speed buttons or the clock */
      if (S.state === 'ready') {
        for (const b of BTN) {
          const on = b.id === S.speed;
          g.fillStyle = on ? hsl(48, 90, 56) : 'rgba(0,0,0,.35)'; rr(g, b.x, b.y, b.w, b.h, 10); g.fill();
          g.strokeStyle = on ? hsl(48, 100, 80) : 'rgba(255,255,255,.2)'; g.lineWidth = 1.5; rr(g, b.x, b.y, b.w, b.h, 10); g.stroke();
          g.fillStyle = on ? '#2a1c00' : '#e8f0e6'; g.font = `700 14px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText(SPEEDS[b.id].name, b.x + b.w / 2, b.y + b.h / 2 + 1);
        }
      } else {
        const frac = clamp(S.left / ROUND, 0, 1);
        g.fillStyle = 'rgba(0,0,0,.4)'; rr(g, 30, 64, VW - 60, 16, 8); g.fill();
        g.fillStyle = frac < 0.2 ? hsl(0, 80, 56) : hsl(48, 90, 56); rr(g, 30, 64, Math.max(10, (VW - 60) * frac), 16, 8); g.fill();
        g.fillStyle = '#fff'; g.font = `700 20px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(`${Math.ceil(S.left)} s`, VW / 2, 36);
      }

      /* the lawn */
      for (let i = 0; i < 9; i++) {
        const { x, y } = holeXY(i);
        g.fillStyle = hsl(28, 40, 24); g.beginPath(); g.ellipse(x, y + 4, 62, 24, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = hsl(24, 30, 10); g.beginPath(); g.ellipse(x, y, 52, 18, 0, 0, Math.PI * 2); g.fill();
        const c = S.crit.find(q => q.hole === i);
        if (c) critter(g, c, x, y);
        g.fillStyle = hsl(28, 45, 34); g.beginPath(); g.ellipse(x, y + 4, 62, 24, 0, 0, Math.PI); g.fill();   /* the front lip hides the critter's base */
        g.fillStyle = hsl(28, 40, 42); g.beginPath(); g.ellipse(x, y + 8, 56, 17, 0, 0, Math.PI); g.fill();
        g.fillStyle = 'rgba(255,255,255,.78)'; g.font = `700 14px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(String(i + 1), x, y + 11);
      }
      if (S.swing) { const { x, y } = holeXY(S.swing.hole); mallet(g, x, y, S.swing.t); }
      for (const q of S.pops) { g.fillStyle = hsl(q.hue, 100, 72, clamp(q.t * 2, 0, 1)); g.font = `800 24px ${FONT}`; g.textAlign = 'center'; g.fillText(q.text, q.x, q.y); }
      g.restore();

      if (S.state === 'ready') prompt(g, sf, coarse() ? 'Tap a speed, then tap anywhere to start' : 'Pick a speed, then press Space', coarse() ? 'Tap the moles. Skip the spike hogs.' : 'Click or press 1-9 to whack. Skip the spike hogs.', 48, sf.h * 0.9);
    }

    /* ------------------------------ input ------------------------------ */
    const toWorld = e => {
      const r = sf.cv.getBoundingClientRect();
      return { x: (e.clientX - r.left - V.ox) / V.s, y: (e.clientY - r.top - V.oy) / V.s };
    };
    const holeAt = p => {
      for (let i = 0; i < 9; i++) {
        const { x, y } = holeXY(i);
        if (Math.abs(p.x - x) < 66 && p.y > y - 96 && p.y < y + 34) return i;
      }
      return -1;
    };
    const onDown = e => {
      if (S.paused || S.state === 'over') return;
      snd.wake();
      const p = toWorld(e);
      if (S.state === 'ready') {
        const b = BTN.find(q => p.x >= q.x && p.x <= q.x + q.w && p.y >= q.y && p.y <= q.y + q.h);
        if (b) { S.speed = b.id; draw(); return; }
        start(); draw(); return;
      }
      const h = holeAt(p);
      if (h >= 0) whack(h);
    };
    const onKey = e => {
      if (!ownsKey(el, e)) return;
      if (S.paused || S.state === 'over') return;
      let h = -1;
      if (/^Digit[1-9]$/.test(e.code)) h = Number(e.code.slice(5)) - 1;
      else if (e.code in PAD) h = PAD[e.code];
      if (h >= 0) {
        e.preventDefault();
        if (e.repeat) return;
        snd.wake();
        if (S.state === 'ready') start(); else whack(h);
      } else if (S.state === 'ready' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        const i = SPEED_IDS.indexOf(S.speed);
        S.speed = SPEED_IDS[clamp(i + (e.key === 'ArrowLeft' ? -1 : 1), 0, 2)];
      } else if (S.state === 'ready' && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault(); snd.wake(); start();
      } else return;
      if (!loop.on && S.state !== 'over') draw();
    };
    window.addEventListener('keydown', onKey);
    sf.cv.addEventListener('pointerdown', onDown);

    draw();
    loop.start();

    return {
      stop() {
        loop.stop();
        window.removeEventListener('keydown', onKey);
        sf.cv.removeEventListener('pointerdown', onDown);
        snd.close();
        sf.destroy();
      },
      pause() { S.paused = true; loop.stop(); draw(); },
      resume() { S.paused = false; if (S.state !== 'over') loop.start(); },
      /* a read-only snapshot for automated play-tests; hole centres are in canvas pixels */
      peek: () => ({
        state: S.state, paused: S.paused, score: S.score, left: S.left, time: S.time, speed: S.speed, hits: { ...S.hits }, misses: S.misses,
        crit: S.crit.map(c => ({ hole: c.hole, kind: c.kind, state: c.state, t: c.t, life: c.life })),
        holes: [...Array(9).keys()].map(i => { const p = holeXY(i); return { x: V.ox + p.x * V.s, y: V.oy + (p.y - 30) * V.s, r: 30 * V.s }; }),
        buttons: BTN.map(b => ({ id: b.id, x: V.ox + (b.x + b.w / 2) * V.s, y: V.oy + (b.y + b.h / 2) * V.s })),
      }),
      /* test hook — nothing in the game calls it:
         manual(bool: stop the clock, step it by hand) · step(seconds) · auto(bool: spawn on its own)
         spawn({ hole, kind: 'mole'|'gold'|'hog', life? }) · clear() · speed('slow'|'medium'|'fast') */
      hook(cmd, arg) {
        let out = true;
        if (cmd === 'step') { for (let t = 0; t < arg; t += 1 / 60) update(1 / 60); }
        else if (cmd === 'manual') S.manual = !!arg;
        else if (cmd === 'auto') S.auto = !!arg;
        else if (cmd === 'spawn') out = spawn(arg.hole, arg.kind, arg.life ?? 60);
        else if (cmd === 'clear') S.crit = [];
        else if (cmd === 'speed' && SPEEDS[arg]) S.speed = arg;
        draw();
        return out;
      },
    };
  },
};
