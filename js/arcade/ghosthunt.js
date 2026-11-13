/* ============================================================
   arcade/ghosthunt.js — Ghost Hunt for Static Arcade.

   A graveyard at night. Ghosts fade in, bob about and fade out
   again; catch each one before it vanishes. The round lasts 45
   seconds and gets busier as it goes: ghosts arrive faster, stay
   for less time and more of them are out at once.

   · A ghost is worth 10, a quick blue wisp 25, a rare gold ghost
     50 and three extra seconds on the clock.
   · Catches in a row build a streak; every five in a row add one
     to the multiplier (up to ×4). A shot that hits nothing, or a
     ghost that gets away, ends the streak.
   · Score = points. The round ends when the clock runs out.

   Input: click or tap a ghost. Keyboard (and a controller, through
   the Arcade's gamepad bridge): arrows / WASD move a crosshair,
   Space or Enter fires. The clock starts with the first shot, so
   there is time to read the prompt.

   Follows the module contract in ./index.js; stop() removes every
   listener, the frame loop and the audio context.
   ============================================================ */

const HUE = 265;
const ROUND = 45;                 /* seconds */
const GOLD_BONUS = 3;             /* seconds a gold ghost adds */
const KINDS = {
  boo:  { pts: 10, size: 1,    hue: 255, light: 94 },
  wisp: { pts: 25, size: 0.72, hue: 190, light: 78 },
  gold: { pts: 50, size: 0.86, hue: 45,  light: 70 },
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;
const FONT = 'Inter,ui-sans-serif,system-ui,sans-serif';
const MONO = '"JetBrains Mono",ui-monospace,Menlo,Consolas,monospace';
/* a touch screen is the main pointer: say "tap", not "click" */
const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
/* a small deterministic hash, so the scenery is the same every frame */
const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

export default {
  mount(el, ctx) {
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    let bg = null;                /* the static scenery, redrawn on resize */
    const sf = surface(el, 'Ghost Hunt — a graveyard at night', () => { bg = null; keepAim(); draw(); });
    const S = {
      state: 'ready',             /* ready | play | end | over */
      paused: false,
      time: 0, left: ROUND, endT: 0,
      score: 0, caught: 0, shots: 0, hits: 0, escaped: 0,
      streak: 0, bestStreak: 0,
      ghosts: [], parts: [], floats: [], spawnT: 0.5, seq: 0,
      aim: { x: 0, y: 0 }, aimV: { x: 0, y: 0 }, mode: coarse() ? 'touch' : 'mouse',
      hover: null, keys: new Set(), tick: 0, flash: 0, shake: 0,
    };
    S.aim.x = sf.w / 2; S.aim.y = sf.h / 2;
    ctx.onScore(0);

    /* the play field: below the HUD strip, above the fog */
    const field = () => {
      const top = 64, bottom = sf.h * 0.84;
      return { top, bottom, h: Math.max(40, bottom - top) };
    };
    const baseR = () => clamp(Math.min(sf.w, sf.h) * 0.072, 22, 54);
    const pos = gh => {
      const f = field(), r = baseR() * KINDS[gh.kind].size;
      const x = r + gh.fx * Math.max(1, sf.w - r * 2);
      const y = f.top + r + gh.fy * Math.max(1, f.h - r * 2);
      const bob = Math.sin(gh.phase + S.time * (gh.kind === 'wisp' ? 4.2 : 2.4)) * r * 0.18;
      return { x, y: y + bob, r };
    };
    const progress = () => clamp(1 - S.left / ROUND, 0, 1);
    function keepAim() { S.aim.x = clamp(S.aim.x, 0, sf.w); S.aim.y = clamp(S.aim.y, 0, sf.h); }

    /* ------------------------------ rules ------------------------------ */
    function spawn(kind, at) {
      const p = progress();
      const g = {
        id: ++S.seq, kind,
        fx: 0.5, fy: 0.5,
        vx: (Math.random() - 0.5) * (kind === 'wisp' ? 0.16 : 0.06),
        phase: Math.random() * Math.PI * 2,
        age: 0, life: lerp(2.5, 1.3, p) * (0.85 + Math.random() * 0.3) * (kind === 'wisp' ? 0.82 : kind === 'gold' ? 0.75 : 1),
        st: 'live', t: 0, dir: Math.random() < 0.5 ? -1 : 1,
      };
      if (at) { g.fx = at.fx; g.fy = at.fy; }
      else {
        /* somewhere not on top of another ghost */
        let best = null;
        for (let i = 0; i < 14; i++) {
          const c = { fx: 0.04 + Math.random() * 0.92, fy: Math.random() };
          const d = Math.min(9, ...S.ghosts.filter(o => o.st === 'live').map(o => Math.hypot((o.fx - c.fx) * sf.w, (o.fy - c.fy) * field().h) / baseR()));
          if (!best || d > best.d) best = { ...c, d };
          if (d > 2.6) break;
        }
        g.fx = best.fx; g.fy = best.fy;
      }
      S.ghosts.push(g);
      return g;
    }

    function pickKind() {
      const p = progress(), r = Math.random();
      if (p > 0.08 && r < 0.055) return 'gold';
      if (r < (p > 0.25 ? 0.3 : 0.12)) return 'wisp';
      return 'boo';
    }

    function begin() {
      if (S.state !== 'ready') return;
      S.state = 'play';
      S.spawnT = 0.35;
      /* the demo ghost now has a life like any other */
      for (const g of S.ghosts) if (g.life === Infinity) { g.life = 2.2; g.age = 0; }
    }

    function shoot(x, y, slack) {
      if (S.paused || S.state === 'end' || S.state === 'over') return;
      snd.wake();
      const first = S.state === 'ready';
      begin();
      S.shots++;
      let hit = null, bestD = Infinity;
      for (const g of S.ghosts) {
        if (g.st !== 'live') continue;
        const p = pos(g);
        const d = Math.hypot(x - p.x, y - p.y);
        if (d <= p.r * 1.06 + slack && d < bestD) { hit = g; bestD = d; }
      }
      if (!hit) {
        if (!first) {
          if (S.streak >= 3) floater(x, y - 18, 'streak lost', 0, 0.9);
          S.streak = 0;
        }
        puff(x, y, 0, 8, 0.6);
        snd.blip(150, 0.09, 'sine', 0.8, 90);
        return;
      }
      catchGhost(hit);
    }

    function catchGhost(g) {
      const k = KINDS[g.kind];
      const mult = Math.min(4, 1 + Math.floor(S.streak / 5));
      const pts = k.pts * mult;
      S.streak++;
      S.bestStreak = Math.max(S.bestStreak, S.streak);
      S.hits++;
      S.caught++;
      S.score += pts;
      ctx.onScore(S.score);
      const p = pos(g);
      g.st = 'pop'; g.t = 0; g.px = p.x; g.py = p.y;
      puff(p.x, p.y, k.hue, g.kind === 'gold' ? 26 : 16, 1);
      floater(p.x, p.y - p.r - 6, `+${pts}`, k.hue, 1, mult > 1 ? `×${mult}` : '');
      if (g.kind === 'gold') {
        S.left += GOLD_BONUS;
        floater(p.x, p.y - p.r - 30, `+${GOLD_BONUS} s`, 45, 1.2);
        snd.blip(784, 0.08, 'triangle', 0.9);
        snd.blip(988, 0.08, 'triangle', 0.9, 0, 0.07);
        snd.blip(1319, 0.14, 'triangle', 0.9, 0, 0.14);
      } else {
        const f = 520 + Math.min(14, S.streak) * 34;
        snd.blip(f, 0.07, 'triangle', 1, f * 1.6);
        if (mult > 1) snd.blip(f * 1.5, 0.06, 'sine', 0.6, 0, 0.05);
      }
      if (S.streak > 0 && S.streak % 5 === 0 && S.streak <= 15) {
        floater(sf.w / 2, 104, `×${Math.min(4, 1 + S.streak / 5)} multiplier`, HUE, 1.4);
      }
    }

    function escape(g) {
      g.st = 'gone'; g.t = 0;
      S.escaped++;
      if (S.state === 'play') {
        if (S.streak >= 3) { const p = pos(g); floater(p.x, p.y - 12, 'streak lost', 0, 0.9); }
        S.streak = 0;
        snd.blip(360, 0.32, 'sine', 0.35, 170);
      }
    }

    function puff(x, y, hue, n, sp) {
      const count = reduced ? Math.ceil(n / 3) : n;
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2, v = (60 + Math.random() * 180) * sp;
        S.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, life: 0.45 + Math.random() * 0.35, max: 0.8, hue, s: 2 + Math.random() * 3 });
      }
    }
    function floater(x, y, text, hue, life, tag = '') {
      S.floats.push({ x, y, text, tag, hue, life, max: life });
    }

    /* ------------------------------ loop ------------------------------ */
    const loop = looper(dt => {
      S.time += dt;
      if (S.flash > 0) S.flash = Math.max(0, S.flash - dt * 2);
      if (S.shake > 0) S.shake = Math.max(0, S.shake - dt * 2);

      /* the crosshair, for keys and a controller */
      if (S.keys.size && S.state !== 'over') {
        const sp = clamp(Math.min(sf.w, sf.h) * 1.15, 420, 980);
        let dx = 0, dy = 0;
        if (S.keys.has('left')) dx -= 1;
        if (S.keys.has('right')) dx += 1;
        if (S.keys.has('up')) dy -= 1;
        if (S.keys.has('down')) dy += 1;
        const n = Math.hypot(dx, dy) || 1;
        S.aimV.x = lerp(S.aimV.x, (dx / n) * sp, clamp(dt * 12, 0, 1));
        S.aimV.y = lerp(S.aimV.y, (dy / n) * sp, clamp(dt * 12, 0, 1));
      } else {
        S.aimV.x = lerp(S.aimV.x, 0, clamp(dt * 16, 0, 1));
        S.aimV.y = lerp(S.aimV.y, 0, clamp(dt * 16, 0, 1));
      }
      S.aim.x = clamp(S.aim.x + S.aimV.x * dt, 0, sf.w);
      S.aim.y = clamp(S.aim.y + S.aimV.y * dt, 0, sf.h);

      if (S.state === 'ready' && !S.ghosts.length) {
        const g = spawn('boo', { fx: 0.5, fy: 0.38 });
        g.life = Infinity; g.vx = 0;
      }
      if (S.state === 'play') {
        S.left -= dt;
        const secs = Math.ceil(S.left);
        if (secs <= 5 && secs >= 1 && secs !== S.tick) { S.tick = secs; snd.blip(880, 0.035, 'square', 0.45); }
        if (S.left <= 0) {
          S.left = 0;
          S.state = 'end';
          S.endT = 0;
          S.streak = 0;
          if (!reduced) S.flash = 1;
          snd.blip(240, 0.5, 'sawtooth', 0.6, 110);
          for (const g of S.ghosts) if (g.st === 'live') { g.st = 'gone'; g.t = 0; }
        } else {
          const p = progress();
          const live = S.ghosts.filter(g => g.st === 'live').length;
          const cap = 2 + Math.floor(p * 4.2);
          S.spawnT -= dt;
          if (S.spawnT <= 0 && live < cap) {
            spawn(pickKind());
            S.spawnT = lerp(0.95, 0.36, p) * (0.8 + Math.random() * 0.4);
          } else if (live === 0 && S.spawnT > 0.25) S.spawnT = 0.25;     /* never an empty sky for long */
        }
      } else if (S.state === 'end') {
        S.endT += dt;
        if (S.endT >= 1.2) {
          S.state = 'over';
          const acc = S.shots ? Math.round((S.hits / S.shots) * 100) : 0;
          ctx.onEnd({
            score: S.score, won: false,
            detail: `Time’s up · ${S.caught} ghost${S.caught === 1 ? '' : 's'} caught · best streak ${S.bestStreak}${S.shots ? ` · ${acc}% of shots hit` : ''}`,
            caught: S.caught, bestStreak: S.bestStreak, shots: S.shots, hits: S.hits,
          });
        }
      }

      for (const g of S.ghosts) {
        g.t += dt;
        if (g.st === 'live') {
          g.age += dt;
          if (!reduced) {
            g.fx += g.vx * dt * g.dir;
            if (g.fx < 0.02 || g.fx > 0.98) { g.dir *= -1; g.fx = clamp(g.fx, 0.02, 0.98); }
          }
          if (g.age >= g.life) escape(g);
        }
      }
      S.ghosts = S.ghosts.filter(g => !((g.st === 'pop' && g.t > 0.4) || (g.st === 'gone' && g.t > 0.55)));
      for (const q of S.parts) { q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 0.92; q.vy = q.vy * 0.92 - 30 * dt; q.life -= dt; }
      S.parts = S.parts.filter(q => q.life > 0);
      for (const f of S.floats) { f.y -= 38 * dt; f.life -= dt; }
      S.floats = S.floats.filter(f => f.life > 0);

      /* what the mouse is over, for a hover ring */
      S.hover = null;
      if (S.mode === 'mouse' && S.pointerIn) {
        for (const g of S.ghosts) {
          if (g.st !== 'live') continue;
          const p = pos(g);
          if (Math.hypot(S.ptr.x - p.x, S.ptr.y - p.y) <= p.r * 1.06) { S.hover = g.id; break; }
        }
      }
      draw();
      if (S.state === 'over' && !S.parts.length && !S.floats.length) loop.stop();
    });

    /* ------------------------------ drawing ------------------------------ */
    function scenery() {
      const W = sf.w, H = sf.h;
      const c = document.createElement('canvas');
      c.width = Math.round(W * sf.dpr); c.height = Math.round(H * sf.dpr);
      const g = c.getContext('2d');
      g.setTransform(sf.dpr, 0, 0, sf.dpr, 0, 0);
      const sky = g.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, '#05030f');
      sky.addColorStop(0.55, '#170c2e');
      sky.addColorStop(0.85, hsl(HUE, 40, 17));
      sky.addColorStop(1, '#0a0614');
      g.fillStyle = sky;
      g.fillRect(0, 0, W, H);
      /* stars */
      for (let i = 0; i < 90; i++) {
        const x = hash(i) * W, y = hash(i + 99) * H * 0.62, s = hash(i + 7) < 0.15 ? 1.8 : 1.1;
        g.fillStyle = `rgba(235,225,255,${0.25 + hash(i + 3) * 0.5})`;
        g.fillRect(x, y, s, s);
      }
      /* the moon */
      const mr = Math.min(W, H) * 0.1, mx = W * 0.8, my = H * 0.22;
      const halo = g.createRadialGradient(mx, my, mr * 0.6, mx, my, mr * 4.2);
      halo.addColorStop(0, 'rgba(255,240,200,.30)');
      halo.addColorStop(0.35, hsl(HUE, 60, 50, 0.12));
      halo.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = halo;
      g.fillRect(0, 0, W, H);
      const moon = g.createRadialGradient(mx - mr * 0.3, my - mr * 0.3, mr * 0.1, mx, my, mr);
      moon.addColorStop(0, '#fffbea');
      moon.addColorStop(1, '#e9dcb0');
      g.fillStyle = moon;
      g.beginPath(); g.arc(mx, my, mr, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(160,140,100,.22)';
      [[-0.3, -0.15, 0.22], [0.25, 0.2, 0.16], [0.05, -0.45, 0.1], [-0.15, 0.4, 0.12]].forEach(([a, b, s]) => {
        g.beginPath(); g.arc(mx + a * mr, my + b * mr, s * mr, 0, Math.PI * 2); g.fill();
      });
      /* far hills, near hill */
      const hill = (base, amp, col, seed) => {
        g.fillStyle = col;
        g.beginPath();
        g.moveTo(0, H);
        for (let x = 0; x <= W + 20; x += 20) {
          const y = base + Math.sin(x * 0.006 + seed) * amp + Math.sin(x * 0.017 + seed * 2) * amp * 0.35;
          g.lineTo(x, y);
        }
        g.lineTo(W, H);
        g.closePath();
        g.fill();
      };
      hill(H * 0.66, H * 0.05, '#100a22', 1.3);
      hill(H * 0.76, H * 0.035, '#0a0617', 4.1);
      /* tombstones along the near hill, lit on the moon side */
      const n = Math.max(5, Math.round(W / 120));
      for (let i = 0; i < n; i++) {
        const x = (i + 0.3 + hash(i + 40) * 0.4) * (W / n);
        const base = H * 0.76 + Math.sin(x * 0.006 + 4.1) * H * 0.035 + 6;
        const s = Math.min(W, H) * (0.035 + hash(i + 50) * 0.02);
        const tilt = (hash(i + 60) - 0.5) * 0.18;
        g.save();
        g.translate(x, base);
        g.rotate(tilt);
        g.fillStyle = '#120c22';
        g.strokeStyle = hsl(HUE, 50, 55, 0.35);
        g.lineWidth = 1.2;
        if (hash(i + 70) < 0.25) {
          g.beginPath();
          g.rect(-s * 0.14, -s * 2.1, s * 0.28, s * 2.1);
          g.rect(-s * 0.6, -s * 1.6, s * 1.2, s * 0.28);
          g.fill(); g.stroke();
        } else {
          g.beginPath();
          g.moveTo(-s * 0.6, 0);
          g.lineTo(-s * 0.6, -s * 1.2);
          g.arc(0, -s * 1.2, s * 0.6, Math.PI, 0);
          g.lineTo(s * 0.6, 0);
          g.closePath();
          g.fill(); g.stroke();
          g.strokeStyle = hsl(HUE, 40, 60, 0.18);
          g.beginPath(); g.moveTo(-s * 0.3, -s * 1.1); g.lineTo(s * 0.3, -s * 1.1); g.moveTo(-s * 0.3, -s * 0.8); g.lineTo(s * 0.2, -s * 0.8); g.stroke();
        }
        g.restore();
      }
      /* a bare tree on the left */
      const branch = (x, y, len, ang, w, depth) => {
        const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
        g.lineWidth = w;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
        if (depth <= 0) return;
        const k = hash(depth * 13 + x * 0.01);
        branch(x2, y2, len * 0.72, ang - 0.42 - k * 0.2, w * 0.66, depth - 1);
        branch(x2, y2, len * 0.66, ang + 0.36 + k * 0.25, w * 0.62, depth - 1);
      };
      g.strokeStyle = '#06030c';
      g.lineCap = 'round';
      const tb = H * 0.8, tl = Math.min(H * 0.22, W * 0.2);
      branch(W * 0.09, tb, tl, -Math.PI / 2 - 0.05, Math.max(4, tl * 0.09), 6);
      /* ground */
      const ground = g.createLinearGradient(0, H * 0.8, 0, H);
      ground.addColorStop(0, '#07040d');
      ground.addColorStop(1, '#030206');
      g.fillStyle = ground;
      g.fillRect(0, H * 0.84, W, H * 0.16);
      return c;
    }

    function fogBand(g, y, hgt, speed, alpha) {
      const W = sf.w;
      const off = reduced ? 0 : (S.time * speed) % W;
      for (let k = -1; k <= 1; k++) {
        for (let i = 0; i < 4; i++) {
          const cx = ((i + 0.5) / 4) * W + off + k * W;
          const r = W * 0.22;
          const grd = g.createRadialGradient(cx, y, 0, cx, y, r);
          grd.addColorStop(0, `rgba(190,170,240,${alpha})`);
          grd.addColorStop(1, 'rgba(190,170,240,0)');
          g.fillStyle = grd;
          g.save();
          g.translate(cx, y);
          g.scale(1, hgt / r);
          g.translate(-cx, -y);
          g.fillRect(cx - r, y - r, r * 2, r * 2);
          g.restore();
        }
      }
    }

    function bat(g, x, y, s, t) {
      const flap = Math.sin(t * 14) * 0.6;
      g.save();
      g.translate(x, y);
      g.fillStyle = '#05030b';
      g.beginPath();
      g.moveTo(0, 0);
      g.quadraticCurveTo(-s * 0.5, -s * (0.5 + flap), -s, -s * 0.1 * flap);
      g.quadraticCurveTo(-s * 0.6, s * 0.05, -s * 0.35, s * 0.15);
      g.quadraticCurveTo(-s * 0.15, 0, 0, s * 0.25);
      g.quadraticCurveTo(s * 0.15, 0, s * 0.35, s * 0.15);
      g.quadraticCurveTo(s * 0.6, s * 0.05, s, -s * 0.1 * flap);
      g.quadraticCurveTo(s * 0.5, -s * (0.5 + flap), 0, 0);
      g.fill();
      g.restore();
    }

    function ghost(g, x, y, r, kind, alpha, scale, t, hot) {
      const k = KINDS[kind];
      g.save();
      g.globalAlpha = clamp(alpha, 0, 1);
      g.translate(x, y);
      g.scale(scale, scale);
      /* glow */
      g.shadowBlur = r * (hot ? 1.3 : 0.9);
      g.shadowColor = hsl(k.hue, 100, 70, 0.85);
      const body = g.createRadialGradient(-r * 0.3, -r * 0.5, r * 0.1, 0, 0, r * 1.4);
      body.addColorStop(0, hsl(k.hue, kind === 'boo' ? 60 : 95, Math.min(99, k.light + 6)));
      body.addColorStop(1, hsl(k.hue, kind === 'boo' ? 35 : 80, k.light - 22));
      g.fillStyle = body;
      g.beginPath();
      g.arc(0, -r * 0.1, r, Math.PI, 0);
      g.lineTo(r, r * 0.78);
      const waves = 4;
      for (let i = 0; i < waves; i++) {
        const x0 = r - (i * 2 * r) / waves, x1 = r - ((i + 1) * 2 * r) / waves;
        const wob = reduced ? 0 : Math.sin(t * 7 + i * 1.7) * r * 0.08;
        g.quadraticCurveTo((x0 + x1) / 2, r * 1.12 + wob, x1, r * 0.78);
      }
      g.closePath();
      g.fill();
      g.shadowBlur = 0;
      /* little arms */
      g.beginPath();
      g.ellipse(-r * 0.98, r * 0.28, r * 0.2, r * 0.12, -0.6, 0, Math.PI * 2);
      g.ellipse(r * 0.98, r * 0.24, r * 0.2, r * 0.12, 0.5, 0, Math.PI * 2);
      g.fill();
      /* face */
      g.fillStyle = kind === 'gold' ? '#3a2200' : '#160b2a';
      g.beginPath();
      g.ellipse(-r * 0.34, -r * 0.18, r * 0.15, r * 0.21, 0, 0, Math.PI * 2);
      g.ellipse(r * 0.34, -r * 0.18, r * 0.15, r * 0.21, 0, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.ellipse(0, r * 0.26, r * 0.12, r * 0.16 + (reduced ? 0 : Math.sin(t * 5) * r * 0.03), 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,.75)';
      g.beginPath();
      g.arc(-r * 0.3, -r * 0.26, r * 0.05, 0, Math.PI * 2);
      g.arc(r * 0.38, -r * 0.26, r * 0.05, 0, Math.PI * 2);
      g.fill();
      if (kind === 'gold' && !reduced) {
        g.strokeStyle = hsl(48, 100, 75, 0.6);
        g.lineWidth = 1.5;
        for (let i = 0; i < 4; i++) {
          const a = t * 2 + (i * Math.PI) / 2, d = r * 1.35;
          const sx = Math.cos(a) * d, sy = Math.sin(a) * d * 0.8;
          g.beginPath(); g.moveTo(sx - 4, sy); g.lineTo(sx + 4, sy); g.moveTo(sx, sy - 4); g.lineTo(sx, sy + 4); g.stroke();
        }
      }
      g.restore();
    }

    function reticle(g, x, y, s, hue) {
      g.save();
      g.strokeStyle = hsl(hue, 100, 75, 0.95);
      g.shadowBlur = 10;
      g.shadowColor = hsl(hue, 100, 60, 0.9);
      g.lineWidth = 2;
      g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.stroke();
      g.beginPath();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        g.moveTo(x + dx * s * 0.55, y + dy * s * 0.55);
        g.lineTo(x + dx * s * 1.45, y + dy * s * 1.45);
      }
      g.stroke();
      g.fillStyle = hsl(hue, 100, 85);
      g.beginPath(); g.arc(x, y, 2, 0, Math.PI * 2); g.fill();
      g.restore();
    }

    function hud(g) {
      const W = sf.w;
      /* the clock as a bar across the top */
      const frac = clamp(S.left / ROUND, 0, 1);
      g.fillStyle = 'rgba(255,255,255,.06)';
      g.fillRect(0, 0, W, 4);
      const low = S.left <= 10 && S.state === 'play';
      const bar = g.createLinearGradient(0, 0, W, 0);
      bar.addColorStop(0, hsl(low ? 0 : HUE, 100, 62));
      bar.addColorStop(1, hsl(low ? 20 : 300, 100, 66));
      g.fillStyle = bar;
      g.fillRect(0, 0, W * Math.min(1, frac), 4);

      const secs = Math.max(0, Math.ceil(S.left));
      const label = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      const pulse = low && !reduced ? 1 + Math.max(0, Math.sin(S.time * Math.PI * 2)) * 0.06 : 1;
      g.save();
      g.translate(18, 34);
      g.fillStyle = 'rgba(6,4,14,.72)';
      g.strokeStyle = hsl(low ? 0 : HUE, 100, 70, 0.35);
      g.lineWidth = 1;
      rr(g, 0, -16, 112, 32, 10);
      g.fill(); g.stroke();
      g.textBaseline = 'middle';
      g.font = `700 10px ${MONO}`;
      g.fillStyle = 'rgba(225,215,255,.55)';
      g.textAlign = 'left';
      g.fillText('TIME', 12, 1);
      g.font = `800 ${Math.round(18 * pulse)}px ${MONO}`;
      g.fillStyle = low ? hsl(0, 100, 72) : '#f3eeff';
      g.textAlign = 'right';
      g.fillText(label, 100, 1);
      g.restore();

      if (S.streak >= 2 || S.state === 'play') {
        const mult = Math.min(4, 1 + Math.floor(S.streak / 5));
        const txt = S.streak >= 2 ? `STREAK ${S.streak}` : 'STREAK —';
        g.save();
        g.font = `700 12px ${MONO}`;
        const tw = g.measureText(txt).width + (mult > 1 ? 40 : 0) + 28;
        g.translate(W - 18 - tw, 34);
        g.fillStyle = 'rgba(6,4,14,.72)';
        g.strokeStyle = hsl(HUE, 100, 70, mult > 1 ? 0.7 : 0.3);
        g.lineWidth = 1;
        rr(g, 0, -16, tw, 32, 10);
        g.fill(); g.stroke();
        g.textBaseline = 'middle';
        g.textAlign = 'left';
        g.fillStyle = S.streak >= 2 ? '#f3eeff' : 'rgba(225,215,255,.45)';
        g.fillText(txt, 14, 1);
        if (mult > 1) {
          g.fillStyle = hsl(HUE + 40, 100, 72);
          g.font = `800 14px ${MONO}`;
          g.textAlign = 'right';
          g.fillText(`×${mult}`, tw - 12, 1);
        }
        g.restore();
      }
    }

    function draw() {
      const g = sf.g;
      sf.begin();
      if (!bg) bg = scenery();
      const W = sf.w, H = sf.h;
      g.save();
      if (S.shake > 0 && !reduced) g.translate((Math.random() - 0.5) * 6 * S.shake, (Math.random() - 0.5) * 6 * S.shake);
      g.drawImage(bg, 0, 0, W, H);
      fogBand(g, H * 0.7, H * 0.05, 14, 0.05);

      /* two bats crossing the moon now and then */
      if (!reduced) {
        for (let i = 0; i < 2; i++) {
          const per = 9 + i * 5, t = ((S.time + i * 4.3) % per) / per;
          if (t < 0.55) {
            const x = lerp(-40, W + 40, t / 0.55), y = H * (0.16 + i * 0.09) + Math.sin(S.time * 3 + i) * 12;
            bat(g, x, y, 10 + i * 3, S.time + i);
          }
        }
      }

      /* ghosts */
      for (const gh of S.ghosts) {
        const k = KINDS[gh.kind];
        if (gh.st === 'pop') {
          const a = 1 - gh.t / 0.4;
          ghost(g, gh.px, gh.py, baseR() * k.size, gh.kind, a, 1 + gh.t * 1.6, S.time, false);
          g.save();
          g.strokeStyle = hsl(k.hue, 100, 75, a);
          g.lineWidth = 3;
          g.beginPath(); g.arc(gh.px, gh.py, baseR() * k.size * (1 + gh.t * 3), 0, Math.PI * 2); g.stroke();
          g.restore();
          continue;
        }
        const p = pos(gh);
        let a = clamp(gh.age / 0.28, 0, 1);
        let y = p.y;
        if (gh.st === 'gone') { a = 1 - gh.t / 0.55; y -= gh.t * 90; }
        else if (gh.life !== Infinity && gh.life - gh.age < 0.6 && !reduced) a *= 0.55 + 0.45 * Math.abs(Math.sin(gh.age * 16));
        else if (gh.life !== Infinity && gh.life - gh.age < 0.6) a *= 0.6;
        ghost(g, p.x, y, p.r, gh.kind, a, 1, S.time + gh.phase, S.hover === gh.id);
        if (S.hover === gh.id && gh.st === 'live') {
          g.save();
          g.strokeStyle = hsl(k.hue, 100, 80, 0.6);
          g.setLineDash([5, 5]);
          g.lineWidth = 1.5;
          g.beginPath(); g.arc(p.x, y, p.r * 1.25, 0, Math.PI * 2); g.stroke();
          g.restore();
        }
      }
      fogBand(g, H * 0.86, H * 0.07, 26, 0.09);

      for (const q of S.parts) {
        g.fillStyle = hsl(q.hue, q.hue ? 100 : 20, q.hue ? 75 : 85, clamp(q.life / q.max, 0, 1));
        g.beginPath(); g.arc(q.x, q.y, q.s, 0, Math.PI * 2); g.fill();
      }
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (const f of S.floats) {
        const a = clamp(f.life / f.max * 1.6, 0, 1);
        g.font = `800 ${f.text.length > 8 ? 13 : 18}px ${FONT}`;
        g.fillStyle = f.hue ? hsl(f.hue, 100, 78, a) : `rgba(255,170,170,${a})`;
        g.fillText(f.text, f.x, f.y);
        if (f.tag) {
          g.font = `800 12px ${MONO}`;
          g.fillStyle = hsl(HUE + 40, 100, 75, a);
          g.fillText(f.tag, f.x, f.y + 16);
        }
      }
      g.restore();

      hud(g);

      if (S.mode === 'keys' && S.state !== 'over' && S.state !== 'end') reticle(g, S.aim.x, S.aim.y, 14, HUE + 50);

      if (S.state === 'end') {
        const a = clamp(S.endT / 0.25, 0, 1);
        g.save();
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = `900 ${Math.round(clamp(W * 0.09, 34, 72))}px ${FONT}`;
        g.fillStyle = hsl(HUE + 40, 100, 80, a);
        g.shadowBlur = 30;
        g.shadowColor = hsl(HUE, 100, 60, a);
        g.fillText('TIME’S UP', W / 2, H * 0.45);
        g.restore();
      }
      if (S.flash > 0) {
        g.fillStyle = `rgba(200,180,255,${S.flash * 0.25})`;
        g.fillRect(0, 0, W, H);
      }
      if (S.state === 'ready') {
        const key = S.mode === 'keys';
        prompt(g, sf,
          coarse() ? 'Tap the ghosts before they vanish' : key ? 'Arrows aim · Space catches' : 'Click the ghosts before they vanish',
          `${ROUND} seconds, starting with your first shot · catches in a row multiply your points`, HUE, H * 0.66);
      }
    }

    /* ------------------------------ input ------------------------------ */
    const DIRS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', KeyA: 'left', KeyD: 'right', KeyW: 'up', KeyS: 'down' };
    const onKey = e => {
      if (!ownsKey(el, e)) return;
      const d = DIRS[e.code];
      if (d) {
        e.preventDefault();
        snd.wake();
        if (S.mode !== 'keys') { S.mode = 'keys'; if (!S.movedByKey) aimHome(); }
        S.movedByKey = true;
        S.keys.add(d);
        if (!loop.on && S.state !== 'over' && !S.paused) loop.start();
        return;
      }
      if (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') {
        if (S.state === 'over') return;               /* Enter after the round is the Arcade's "play again" */
        e.preventDefault();
        if (e.repeat) return;
        if (S.mode !== 'keys') { S.mode = 'keys'; if (!S.movedByKey) aimHome(); }
        shoot(S.aim.x, S.aim.y, 6);
      }
    };
    /* the crosshair starts on the ghost that waits on the start screen */
    function aimHome() {
      const demo = S.ghosts.find(g => g.st === 'live');
      const p = demo ? pos(demo) : { x: sf.w / 2, y: field().top + field().h * 0.4 };
      S.aim.x = p.x; S.aim.y = p.y;
    }
    const onKeyUp = e => {
      const d = DIRS[e.code];
      if (d) S.keys.delete(d);
    };
    const onBlur = () => S.keys.clear();
    const local = e => {
      const r = sf.cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onDown = e => {
      if (e.button > 0) return;
      e.preventDefault();
      const p = local(e);
      S.mode = e.pointerType === 'touch' || e.pointerType === 'pen' ? 'touch' : 'mouse';
      S.ptr = p; S.pointerIn = true;
      S.aim.x = p.x; S.aim.y = p.y;
      shoot(p.x, p.y, e.pointerType === 'touch' ? 14 : 2);
    };
    const onMove = e => {
      if (e.pointerType !== 'mouse') return;
      /* while aiming with keys, a nudged desk is not a switch back to the
         mouse: it has to travel a little from where it was first seen */
      if (S.mode === 'keys') {
        if (!S.anchor) S.anchor = { x: e.clientX, y: e.clientY };
        if (Math.hypot(e.clientX - S.anchor.x, e.clientY - S.anchor.y) < 12) return;
      }
      S.anchor = null;
      S.mode = 'mouse';
      S.ptr = local(e);
      S.pointerIn = true;
    };
    const onLeave = () => { S.pointerIn = false; };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    sf.cv.style.cursor = 'crosshair';
    sf.cv.addEventListener('pointerdown', onDown);
    sf.cv.addEventListener('pointermove', onMove);
    sf.cv.addEventListener('pointerleave', onLeave);

    loop.start();

    return {
      stop() {
        loop.stop();
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onBlur);
        sf.cv.removeEventListener('pointerdown', onDown);
        sf.cv.removeEventListener('pointermove', onMove);
        sf.cv.removeEventListener('pointerleave', onLeave);
        snd.close();
        sf.destroy();
      },
      pause() { S.paused = true; S.keys.clear(); loop.stop(); draw(); },
      resume() { S.paused = false; if (S.state !== 'over') loop.start(); },
      /* a read-only snapshot for automated play-tests (CSS px, relative to the canvas) */
      peek: () => ({
        state: S.state, paused: S.paused, left: S.left, score: S.score, caught: S.caught,
        streak: S.streak, bestStreak: S.bestStreak, shots: S.shots, hits: S.hits, escaped: S.escaped,
        aim: { ...S.aim }, size: { w: sf.w, h: sf.h },
        ghosts: S.ghosts.filter(g => g.st === 'live').map(g => { const p = pos(g); return { id: g.id, kind: g.kind, x: p.x, y: p.y, r: p.r, left: g.life - g.age }; }),
      }),
    };
  },
};

/* ---- module kit (the same few helpers in every built-in Arcade game) ---- */

/* A canvas that fills `el`, backed at devicePixelRatio, refit on resize. */
function surface(el, label, onFit) {
  const cv = document.createElement('canvas');
  cv.setAttribute('role', 'img');
  cv.setAttribute('aria-label', label);
  cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;user-select:none;-webkit-user-select:none';
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
  el.appendChild(cv);
  const s = { cv, g: cv.getContext('2d'), w: 0, h: 0, dpr: 1 };
  let armed = false;                 /* the first fit happens before the game exists */
  const fit = () => {
    const w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight);
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    if (w === s.w && h === s.h && dpr === s.dpr) return;
    s.w = w; s.h = h; s.dpr = dpr;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    if (armed) onFit?.(s);
  };
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
  ro?.observe(el);
  window.addEventListener('resize', fit);
  fit();
  armed = true;
  s.begin = () => s.g.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
  s.destroy = () => { ro?.disconnect(); window.removeEventListener('resize', fit); cv.remove(); };
  return s;
}

/* Should this keydown drive the game? Not while another window is in
   front, not while typing in a field, and a Space/Enter aimed at a
   button outside the game belongs to that button. */
function ownsKey(el, e) {
  if (!el.isConnected || e.ctrlKey || e.metaKey || e.altKey) return false;
  const win = el.closest('.win');
  if (win && !win.classList.contains('is-active')) return false;
  const t = e.target;
  if (t && t.closest) {
    if (t.closest('input,textarea,select,[contenteditable=""],[contenteditable="true"]')) return false;
    if ((e.key === ' ' || e.key === 'Enter') && !el.contains(t) && t.closest('button,a,[role="button"]')) return false;
  }
  return true;
}

/* Tiny synth blips, made on the first input (browsers only start audio
   from a gesture) and closed in stop(). Silent while ctx.sound is off.
   `delay` (seconds) schedules a blip a little later, for short jingles. */
function sounder(ctx) {
  let ac = null, dead = false;
  const get = () => {
    if (dead || ctx.sound === false) return null;
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { ac = new AC(); } catch (err) { return null; }
    }
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    return ac;
  };
  return {
    wake() { get(); },
    blip(freq, dur = 0.07, type = 'square', vol = 1, to = 0, delay = 0) {
      const c = get();
      if (!c || c.state !== 'running') return;
      try {
        const t = c.currentTime + delay, o = c.createOscillator(), gn = c.createGain();
        const peak = 0.05 * vol * (typeof ctx.volume === 'number' ? ctx.volume : 0.6);
        o.type = type;
        o.frequency.setValueAtTime(freq, t);
        if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
        gn.gain.setValueAtTime(0.0001, t);
        gn.gain.linearRampToValueAtTime(peak, t + 0.005);
        gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(gn).connect(c.destination);
        o.start(t);
        o.stop(t + dur + 0.02);
      } catch (err) { /* audio can fail at any point; the game goes on */ }
    },
    close() {
      dead = true;
      try { ac?.close()?.catch?.(() => {}); } catch (err) { /* already closed */ }
      ac = null;
    },
  };
}

/* requestAnimationFrame loop with a clamped dt; start/stop for pause. */
function looper(step) {
  let raf = 0, last = 0, on = false;
  const tick = now => {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    step(dt, now);
  };
  return {
    start() { if (on) return; on = true; last = performance.now(); raf = requestAnimationFrame(tick); },
    stop() { on = false; cancelAnimationFrame(raf); },
    get on() { return on; },
  };
}

function rr(g, x, y, w, h, r) {
  const q = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + q, y);
  g.arcTo(x + w, y, x + w, y + h, q);
  g.arcTo(x + w, y + h, x, y + h, q);
  g.arcTo(x, y + h, x, y, q);
  g.arcTo(x, y, x + w, y, q);
  g.closePath();
}

/* A two-line hint on a dark pill, centred on (sf.w/2, cy). */
function prompt(g, sf, line1, line2, hue, cy = sf.h / 2) {
  const k = Math.min(1, sf.w / 520);
  const f1 = Math.round(15 * Math.max(0.8, k)), f2 = Math.round(12 * Math.max(0.85, k));
  g.font = `650 ${f1}px ${FONT}`;
  const w1 = g.measureText(line1).width;
  g.font = `500 ${f2}px ${FONT}`;
  const w2 = line2 ? g.measureText(line2).width : 0;
  const w = Math.min(sf.w - 24, Math.max(w1, w2) + 40), h = line2 ? f1 + f2 + 34 : f1 + 26;
  const x = (sf.w - w) / 2, y = cy - h / 2;
  g.save();
  g.fillStyle = 'rgba(4,6,10,.78)';
  g.strokeStyle = hsl(hue, 100, 65, 0.45);
  g.lineWidth = 1;
  rr(g, x, y, w, h, 12);
  g.fill();
  g.stroke();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#f4f7f5';
  g.font = `650 ${f1}px ${FONT}`;
  g.fillText(line1, sf.w / 2, y + 13 + f1 / 2, w - 20);
  if (line2) {
    g.fillStyle = hsl(hue, 60, 78, 0.85);
    g.font = `500 ${f2}px ${FONT}`;
    g.fillText(line2, sf.w / 2, y + 21 + f1 + f2 / 2, w - 20);
  }
  g.restore();
}
