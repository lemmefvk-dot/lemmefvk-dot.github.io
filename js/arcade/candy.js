/* ============================================================
   arcade/candy.js — Candy Catcher for Static Arcade.

   Trick-or-treat night. Candy falls from the sky; catch it in a
   jack-o'-lantern bucket. Spiders drop on their threads too —
   catch one of those and you lose a life. Three lives.

   · Wrapped sweets 1 point, candy corn 2, lollipops 3, and now
     and then a gold bar for 10.
   · Ten catches in a row add one to the multiplier (up to ×3); a
     sweet that lands on the pavement ends the run of catches.
   · Everything speeds up over about a minute and a half, and the
     share of spiders grows. Score = points.

   Bucket: the mouse or a finger anywhere over the street, or
   ← → / A D (a controller's D-pad and stick through the Arcade's
   gamepad bridge). The street is an 800-wide arena scaled to fit,
   its height fixed for the round from the shape of the play area.

   Follows the module contract in ./index.js; stop() removes every
   listener, the frame loop and the audio context.
   ============================================================ */

const HUE = 28;
const W = 800;
const LIVES = 3;
const BW = 112;                    /* bucket width */
const OPEN = 84;                   /* the mouth of the bucket that catches */
const ITEMS = {
  wrap:  { pts: 1,  r: 15, w: 50 },
  corn:  { pts: 2,  r: 14, w: 26 },
  pop:   { pts: 3,  r: 15, w: 18 },
  gold:  { pts: 10, r: 17, w: 4 },
  spider:{ pts: 0,  r: 16 },
};
const WRAP_HUES = [330, 200, 140, 275, 50, 0];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;
const FONT = 'Inter,ui-sans-serif,system-ui,sans-serif';
const MONO = '"JetBrains Mono",ui-monospace,Menlo,Consolas,monospace';
/* a touch screen is the main pointer: say "drag", not "move the mouse" */
const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

export default {
  mount(el, ctx) {
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    let bg = null;
    const sf = surface(el, 'Candy Catcher — a street on Halloween night', () => { bg = null; draw(); });
    /* the street's height follows the play area's shape, once per round */
    const H = sf.w > 40 && sf.h > 40 ? clamp(Math.round((W * sf.h) / sf.w / 20) * 20, 520, 1000) : 600;
    const GROUND = H - 64;
    const RIM = GROUND - 66;          /* the bucket's mouth */
    const S = {
      state: 'ready',                 /* ready | play | dying | over */
      paused: false,
      t: 0, time: 0, score: 0, lives: LIVES, combo: 0, bestCombo: 0,
      caught: 0, missed: 0, bitten: 0,
      bx: W / 2, bv: 0, target: null, keys: new Set(),
      items: [], parts: [], floats: [], spawnT: 0.6, seq: 0,
      hurtT: 0, flash: 0, shake: 0, dieT: 0,
    };
    const view = () => {
      const k = Math.min(sf.w / W, sf.h / H);
      return { k, ox: (sf.w - W * k) / 2, oy: (sf.h - H * k) / 2 };
    };
    ctx.onScore(0);

    /* ------------------------------ rules ------------------------------ */
    const level = () => clamp(S.t / 95, 0, 1);

    function spawn() {
      const p = level();
      const spider = Math.random() < lerp(0.15, 0.36, p);
      let kind = 'spider';
      if (!spider) {
        const pool = ['wrap', 'corn', 'pop', 'gold'];
        const tot = pool.reduce((n, k) => n + ITEMS[k].w, 0);
        let r = Math.random() * tot;
        kind = pool.find(k => (r -= ITEMS[k].w) < 0) || 'wrap';
      }
      /* not straight on top of the last thing that fell */
      let x = 0;
      for (let i = 0; i < 8; i++) {
        x = 40 + Math.random() * (W - 80);
        if (!S.items.some(it => it.y < 120 && Math.abs(it.x - x) < 70)) break;
      }
      const v = lerp(165, 420, p) * (0.85 + Math.random() * 0.3) * (kind === 'spider' ? 0.92 : 1);
      S.items.push({
        id: ++S.seq, kind, x, y: -24, vy: v, rot: Math.random() * Math.PI * 2, spin: (Math.random() - 0.5) * 3,
        hue: WRAP_HUES[Math.floor(Math.random() * WRAP_HUES.length)],
        /* some spiders stop halfway, bob on their thread, then drop */
        yo: kind === 'spider' && Math.random() < 0.35 + p * 0.25 ? { at: lerp(H * 0.25, RIM - 140, Math.random()), wait: 0.5 + Math.random() * 0.7 } : null,
        st: 'fall', t: 0,
      });
    }

    function begin() {
      if (S.state !== 'ready') return;
      S.state = 'play';
      S.spawnT = 0.3;
    }

    function caughtItem(it) {
      if (it.kind === 'spider') {
        if (S.hurtT > 0) { it.st = 'bounce'; it.t = 0; return; }
        it.st = 'bounce'; it.t = 0;
        S.lives--;
        S.bitten++;
        S.combo = 0;
        S.hurtT = 1.1;
        if (!reduced) { S.flash = 1; S.shake = 1; }
        floater(it.x, RIM - 30, 'OUCH!', 0, 1);
        burst(it.x, RIM, 0, 14);
        snd.blip(180, 0.28, 'sawtooth', 0.9, 70);
        if (S.lives <= 0) { S.state = 'dying'; S.dieT = 0; }
        return;
      }
      it.st = 'got'; it.t = 0;
      const mult = Math.min(3, 1 + Math.floor(S.combo / 10));
      const pts = ITEMS[it.kind].pts * mult;
      S.combo++;
      S.bestCombo = Math.max(S.bestCombo, S.combo);
      S.caught++;
      S.score += pts;
      ctx.onScore(S.score);
      floater(it.x, RIM - 26, `+${pts}`, it.kind === 'gold' ? 48 : it.kind === 'wrap' ? it.hue : HUE, 0.9);
      burst(it.x, RIM + 4, it.kind === 'gold' ? 48 : HUE + 15, it.kind === 'gold' ? 18 : 8);
      if (it.kind === 'gold') {
        snd.blip(660, 0.07, 'triangle', 0.9);
        snd.blip(880, 0.07, 'triangle', 0.9, 0, 0.06);
        snd.blip(1320, 0.12, 'triangle', 0.9, 0, 0.12);
      } else {
        const f = 600 + Math.min(20, S.combo) * 22;
        snd.blip(f, 0.06, 'triangle', 0.9, f * 1.4);
      }
      if (S.combo % 10 === 0 && S.combo <= 20) {
        floater(W / 2, 120, `×${Math.min(3, 1 + S.combo / 10)} multiplier`, HUE + 20, 1.4);
        snd.blip(990, 0.1, 'square', 0.5, 1480, 0.08);
      }
    }

    function burst(x, y, hue, n) {
      const c = reduced ? Math.ceil(n / 3) : n;
      for (let i = 0; i < c; i++) {
        const a = -Math.PI * Math.random(), v = 80 + Math.random() * 200;
        S.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.4 + Math.random() * 0.4, max: 0.8, hue, s: 2 + Math.random() * 2.5 });
      }
    }
    function floater(x, y, text, hue, life) { S.floats.push({ x, y, text, hue, life, max: life }); }

    /* ------------------------------ loop ------------------------------ */
    const loop = looper(dt => {
      S.time += dt;
      if (S.flash > 0) S.flash = Math.max(0, S.flash - dt * 2.4);
      if (S.shake > 0) S.shake = Math.max(0, S.shake - dt * 2.6);
      if (S.hurtT > 0) S.hurtT = Math.max(0, S.hurtT - dt);

      /* the bucket */
      const lo = BW / 2 + 8, hi = W - BW / 2 - 8;
      const dir = (S.keys.has('right') ? 1 : 0) - (S.keys.has('left') ? 1 : 0);
      if (S.state !== 'dying' && S.state !== 'over') {
        if (dir) {
          S.target = null;
          S.bv = clamp(S.bv + dir * 5200 * dt, -780, 780);
          if (Math.sign(S.bv) !== dir) S.bv += dir * 4000 * dt;
        } else if (S.target !== null) {
          const d = S.target - S.bx;
          const want = clamp(d * 14, -1700, 1700);
          S.bv = lerp(S.bv, want, clamp(dt * 18, 0, 1));
        } else {
          S.bv = lerp(S.bv, 0, clamp(dt * 10, 0, 1));
        }
        S.bx = clamp(S.bx + S.bv * dt, lo, hi);
        if (S.bx === lo || S.bx === hi) S.bv = 0;
      }

      if (S.state === 'play') {
        S.t += dt;
        S.spawnT -= dt;
        if (S.spawnT <= 0) {
          spawn();
          S.spawnT = lerp(0.85, 0.4, level()) * (0.8 + Math.random() * 0.4);
        }
      } else if (S.state === 'dying') {
        S.dieT += dt;
        if (S.dieT >= 1.1) {
          S.state = 'over';
          ctx.onEnd({
            score: S.score, won: false,
            detail: `${S.caught} sweet${S.caught === 1 ? '' : 's'} caught · best run ${S.bestCombo} in a row · lasted ${Math.round(S.t)} s`,
            caught: S.caught, bestCombo: S.bestCombo, seconds: Math.round(S.t),
          });
        }
      }

      if (S.state === 'play' || S.state === 'dying') {
        for (const it of S.items) {
          it.t += dt;
          it.rot += it.spin * dt;
          if (it.st === 'fall') {
            if (it.yo && it.y >= it.yo.at && it.yo.wait > 0) {
              it.yo.wait -= dt;
              it.bob = (it.bob || 0) + dt;
              continue;
            }
            const prev = it.y;
            it.y += it.vy * dt;
            if (S.state === 'play' && prev < RIM && it.y >= RIM - 4 && Math.abs(it.x - S.bx) <= OPEN / 2 + ITEMS[it.kind].r * 0.35) {
              caughtItem(it);
            } else if (it.y >= GROUND - 6) {
              it.y = GROUND - 6;
              it.st = 'landed'; it.t = 0;
              if (it.kind !== 'spider') {
                S.missed++;
                if (S.combo >= 5 && S.state === 'play') floater(it.x, GROUND - 40, 'run over', 0, 0.9);
                if (S.state === 'play') S.combo = 0;
                snd.blip(130, 0.08, 'sine', 0.5, 80);
              }
            }
          } else if (it.st === 'bounce') {
            it.y -= 260 * dt;
            it.x += (it.x < S.bx ? -1 : 1) * 140 * dt;
          }
        }
        S.items = S.items.filter(it => !((it.st === 'got' && it.t > 0.18) || (it.st === 'landed' && it.t > 0.7) || (it.st === 'bounce' && it.t > 0.8)));
      }
      for (const q of S.parts) { q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 520 * dt; q.life -= dt; }
      S.parts = S.parts.filter(q => q.life > 0);
      for (const f of S.floats) { f.y -= 44 * dt; f.life -= dt; }
      S.floats = S.floats.filter(f => f.life > 0);
      draw();
      if (S.state === 'over' && !S.parts.length && !S.floats.length) loop.stop();
    });

    /* ------------------------------ drawing ------------------------------ */
    function scenery() {
      const c = document.createElement('canvas');
      c.width = Math.round(sf.w * sf.dpr); c.height = Math.round(sf.h * sf.dpr);
      const g = c.getContext('2d');
      g.setTransform(sf.dpr, 0, 0, sf.dpr, 0, 0);
      /* full-bleed sky behind the arena */
      const sky = g.createLinearGradient(0, 0, 0, sf.h);
      sky.addColorStop(0, '#07041a');
      sky.addColorStop(0.6, '#24103a');
      sky.addColorStop(0.86, '#5a2440');
      sky.addColorStop(1, '#1a0b14');
      g.fillStyle = sky;
      g.fillRect(0, 0, sf.w, sf.h);
      const { k, ox, oy } = view();
      g.translate(ox, oy);
      g.scale(k, k);
      /* stars and moon */
      for (let i = 0; i < 70; i++) {
        g.fillStyle = `rgba(255,236,220,${0.2 + hash(i + 5) * 0.5})`;
        g.fillRect(hash(i) * W, hash(i + 31) * H * 0.5, 1.6, 1.6);
      }
      const mx = W * 0.2, my = H * 0.16, mr = 46;
      const halo = g.createRadialGradient(mx, my, mr * 0.5, mx, my, mr * 4);
      halo.addColorStop(0, 'rgba(255,220,170,.28)');
      halo.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = halo;
      g.fillRect(mx - mr * 4, my - mr * 4, mr * 8, mr * 8);
      g.fillStyle = '#ffeec8';
      g.beginPath(); g.arc(mx, my, mr, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#2a1436';
      g.beginPath(); g.arc(mx + mr * 0.42, my - mr * 0.12, mr * 0.9, 0, Math.PI * 2); g.fill();
      /* houses along the street, windows lit */
      const baseY = GROUND - 30;
      const houses = 6;
      for (let i = 0; i < houses; i++) {
        const hw = 120 + hash(i + 3) * 60, hx = (i / houses) * W - 20 + hash(i + 9) * 40;
        const hh = H * (0.2 + hash(i + 11) * 0.12);
        const top = baseY - hh;
        g.fillStyle = i % 2 ? '#130a1f' : '#180c26';
        g.fillRect(hx, top, hw, hh);
        g.beginPath();
        g.moveTo(hx - 10, top);
        g.lineTo(hx + hw / 2, top - hw * 0.42);
        g.lineTo(hx + hw + 10, top);
        g.closePath();
        g.fill();
        /* chimney */
        g.fillRect(hx + hw * 0.7, top - hw * 0.34, 14, hw * 0.24);
        /* windows */
        for (let r = 0; r < 2; r++) for (let w = 0; w < 2; w++) {
          if (hash(i * 7 + r * 3 + w) < 0.3) continue;
          const wx = hx + hw * (0.2 + w * 0.42), wy = top + hh * (0.16 + r * 0.42);
          const wl = g.createLinearGradient(0, wy, 0, wy + 30);
          wl.addColorStop(0, '#ffcf6b');
          wl.addColorStop(1, '#ff8a2a');
          g.save();
          g.shadowBlur = 18;
          g.shadowColor = 'rgba(255,160,60,.8)';
          g.fillStyle = wl;
          g.fillRect(wx, wy, 26, 30);
          g.restore();
          g.fillStyle = '#130a1f';
          g.fillRect(wx + 12, wy, 2, 30);
          g.fillRect(wx, wy + 14, 26, 2);
        }
      }
      /* fence */
      g.fillStyle = '#0c0614';
      for (let x = -4; x < W + 20; x += 22) {
        g.beginPath();
        g.moveTo(x, baseY + 26);
        g.lineTo(x, baseY - 6);
        g.lineTo(x + 6, baseY - 14);
        g.lineTo(x + 12, baseY - 6);
        g.lineTo(x + 12, baseY + 26);
        g.closePath();
        g.fill();
      }
      g.fillRect(-10, baseY + 2, W + 20, 5);
      g.fillRect(-10, baseY + 16, W + 20, 5);
      /* pavement */
      const pave = g.createLinearGradient(0, GROUND, 0, H);
      pave.addColorStop(0, '#2a1a2a');
      pave.addColorStop(1, '#120a12');
      g.fillStyle = pave;
      g.fillRect(-W, GROUND, W * 3, H - GROUND + 400);
      g.fillStyle = 'rgba(255,170,90,.18)';
      g.fillRect(-W, GROUND, W * 3, 2);
      g.strokeStyle = 'rgba(0,0,0,.35)';
      g.lineWidth = 2;
      for (let x = 30; x < W; x += 90) { g.beginPath(); g.moveTo(x, GROUND + 4); g.lineTo(x - 12, H); g.stroke(); }
      /* fallen leaves */
      for (let i = 0; i < 18; i++) {
        g.fillStyle = hsl(15 + hash(i + 70) * 30, 80, 30 + hash(i + 71) * 15, 0.8);
        g.beginPath();
        g.ellipse(hash(i + 72) * W, GROUND + 10 + hash(i + 73) * (H - GROUND - 20), 6, 3, hash(i) * 3, 0, Math.PI * 2);
        g.fill();
      }
      return c;
    }

    function bucket(g, x, tilt, blink) {
      const y = RIM;
      g.save();
      g.translate(x, y + 34);
      g.rotate(tilt);
      g.translate(0, -34);
      if (blink) g.globalAlpha = 0.45;
      /* shadow */
      g.fillStyle = 'rgba(0,0,0,.35)';
      g.beginPath(); g.ellipse(0, GROUND - y - 2, BW * 0.5, 9, 0, 0, Math.PI * 2); g.fill();
      /* handle */
      g.strokeStyle = '#1b1210';
      g.lineWidth = 5;
      g.beginPath(); g.arc(0, 4, BW * 0.46, Math.PI * 1.08, Math.PI * 1.92); g.stroke();
      /* body */
      const body = g.createRadialGradient(-BW * 0.18, 18, 6, 0, 30, BW * 0.7);
      body.addColorStop(0, '#ffad4a');
      body.addColorStop(0.6, '#f07a12');
      body.addColorStop(1, '#a8420a');
      g.fillStyle = body;
      g.shadowBlur = 22;
      g.shadowColor = hsl(HUE, 100, 50, 0.55);
      g.beginPath();
      g.moveTo(-BW / 2, 4);
      g.bezierCurveTo(-BW * 0.62, 40, -BW * 0.42, 66, -BW * 0.2, 66);
      g.lineTo(BW * 0.2, 66);
      g.bezierCurveTo(BW * 0.42, 66, BW * 0.62, 40, BW / 2, 4);
      g.closePath();
      g.fill();
      g.shadowBlur = 0;
      /* ribs */
      g.strokeStyle = 'rgba(120,40,0,.45)';
      g.lineWidth = 2;
      for (const s of [-0.22, 0.22]) {
        g.beginPath(); g.moveTo(BW * s, 6); g.quadraticCurveTo(BW * s * 1.35, 36, BW * s * 0.8, 64); g.stroke();
      }
      /* the face, lit from inside */
      g.fillStyle = '#ffd24a';
      g.shadowBlur = 12;
      g.shadowColor = 'rgba(255,200,60,.9)';
      g.beginPath();
      g.moveTo(-30, 26); g.lineTo(-14, 26); g.lineTo(-22, 14); g.closePath();
      g.moveTo(14, 26); g.lineTo(30, 26); g.lineTo(22, 14); g.closePath();
      g.fill();
      g.beginPath();
      g.moveTo(-32, 38);
      g.quadraticCurveTo(0, 60, 32, 38);
      g.lineTo(22, 40); g.lineTo(18, 46); g.lineTo(12, 41); g.lineTo(4, 48); g.lineTo(-4, 42); g.lineTo(-12, 48); g.lineTo(-18, 41); g.lineTo(-24, 45);
      g.closePath();
      g.fill();
      g.shadowBlur = 0;
      /* the rim: a dark opening with candy peeking out */
      g.fillStyle = '#4a1a04';
      g.beginPath(); g.ellipse(0, 4, BW / 2, 9, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#1c0a02';
      g.beginPath(); g.ellipse(0, 5, BW / 2 - 5, 6, 0, 0, Math.PI * 2); g.fill();
      if (S.caught) {
        const n = Math.min(5, 1 + Math.floor(S.caught / 4));
        for (let i = 0; i < n; i++) {
          g.fillStyle = hsl(WRAP_HUES[i % WRAP_HUES.length], 85, 60);
          g.beginPath(); g.arc(-28 + i * 14, 3 - (i % 2) * 3, 6, Math.PI, 0); g.fill();
        }
      }
      g.restore();
    }

    function sweet(g, it) {
      const { kind } = it;
      g.save();
      g.translate(it.x, it.y);
      if (kind === 'wrap') {
        g.rotate(it.rot);
        const c = hsl(it.hue, 85, 58), d = hsl(it.hue, 80, 38);
        g.fillStyle = d;
        g.beginPath(); g.moveTo(-11, 0); g.lineTo(-22, -9); g.lineTo(-20, 0); g.lineTo(-22, 9); g.closePath(); g.fill();
        g.beginPath(); g.moveTo(11, 0); g.lineTo(22, -9); g.lineTo(20, 0); g.lineTo(22, 9); g.closePath(); g.fill();
        const b = g.createLinearGradient(0, -9, 0, 9);
        b.addColorStop(0, hsl(it.hue, 90, 72)); b.addColorStop(1, c);
        g.fillStyle = b;
        g.beginPath(); g.ellipse(0, 0, 13, 9, 0, 0, Math.PI * 2); g.fill();
        g.strokeStyle = 'rgba(255,255,255,.55)';
        g.lineWidth = 2;
        g.beginPath(); g.moveTo(-5, -8); g.lineTo(-1, 8); g.moveTo(3, -8); g.lineTo(7, 7); g.stroke();
      } else if (kind === 'corn') {
        g.rotate(Math.sin(it.rot) * 0.5);
        g.beginPath(); g.moveTo(0, 15); g.lineTo(-11, -11); g.quadraticCurveTo(0, -16, 11, -11); g.closePath();
        g.save(); g.clip();
        g.fillStyle = '#ffd23d'; g.fillRect(-14, -18, 28, 12);
        g.fillStyle = '#ff7f1a'; g.fillRect(-14, -6, 28, 11);
        g.fillStyle = '#fff6e8'; g.fillRect(-14, 5, 28, 12);
        g.restore();
        g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 1;
        g.stroke();
      } else if (kind === 'pop') {
        g.strokeStyle = '#f1ece4'; g.lineWidth = 3;
        g.beginPath(); g.moveTo(0, 10); g.lineTo(0, 30); g.stroke();
        g.fillStyle = hsl(320, 85, 62);
        g.beginPath(); g.arc(0, 0, 14, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#fff';
        g.lineWidth = 2.5;
        g.beginPath();
        for (let a = 0; a < Math.PI * 5; a += 0.2) {
          const r = 1 + a * 0.85, x = Math.cos(a + it.rot) * r, y = Math.sin(a + it.rot) * r;
          a ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.stroke();
      } else if (kind === 'gold') {
        g.rotate(Math.sin(it.rot) * 0.25);
        g.shadowBlur = 18; g.shadowColor = 'rgba(255,210,80,.9)';
        const b = g.createLinearGradient(0, -10, 0, 10);
        b.addColorStop(0, '#fff1a8'); b.addColorStop(0.5, '#f6c23a'); b.addColorStop(1, '#b88310');
        g.fillStyle = b;
        rr(g, -19, -11, 38, 22, 4); g.fill();
        g.shadowBlur = 0;
        g.strokeStyle = 'rgba(120,80,0,.6)'; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(-6, -11); g.lineTo(-6, 11); g.moveTo(6, -11); g.lineTo(6, 11); g.stroke();
        if (!reduced) {
          g.fillStyle = 'rgba(255,255,255,.8)';
          const s = (S.time * 2) % 2 - 1;
          g.fillRect(-19 + (s + 1) * 19, -10, 2.5, 20);
        }
      }
      g.restore();
    }

    function spider(g, it) {
      const bob = it.bob ? Math.sin(it.bob * 9) * 6 : 0;
      const y = it.y + bob;
      g.save();
      g.strokeStyle = 'rgba(230,225,240,.35)';
      g.lineWidth = 1;
      if (it.st !== 'bounce') { g.beginPath(); g.moveTo(it.x, -10); g.lineTo(it.x, y - 10); g.stroke(); }
      g.translate(it.x, y);
      const wig = reduced ? 0 : Math.sin(S.time * 18 + it.id) * 0.15;
      g.strokeStyle = '#120a18';
      g.lineWidth = 2.6;
      g.lineCap = 'round';
      for (const s of [-1, 1]) for (let i = 0; i < 4; i++) {
        const a = (-0.7 + i * 0.45) + (i % 2 ? wig : -wig);
        g.beginPath();
        g.moveTo(0, 0);
        const kx = s * 14, ky = -6 + i * 5 + Math.sin(a) * 4;
        g.quadraticCurveTo(kx * 0.6, ky - 9, kx, ky);
        g.lineTo(s * 20, ky + 9);
        g.stroke();
      }
      const b = g.createRadialGradient(-3, -4, 1, 0, 0, 14);
      b.addColorStop(0, '#3a2648'); b.addColorStop(1, '#0d0712');
      g.fillStyle = b;
      g.beginPath(); g.ellipse(0, 2, 11, 12, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(0, -10, 6.5, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ff3b4e';
      g.shadowBlur = 6; g.shadowColor = '#ff2040';
      g.beginPath(); g.arc(-2.6, -11, 1.8, 0, Math.PI * 2); g.arc(2.6, -11, 1.8, 0, Math.PI * 2); g.fill();
      g.shadowBlur = 0;
      g.fillStyle = 'rgba(200,40,60,.6)';
      g.beginPath(); g.moveTo(0, -2); g.lineTo(3, 3); g.lineTo(0, 8); g.lineTo(-3, 3); g.closePath(); g.fill();
      g.restore();
    }

    function hud(g) {
      g.save();
      g.textBaseline = 'middle';
      g.font = `700 13px ${MONO}`;
      g.fillStyle = 'rgba(255,230,215,.6)';
      g.textAlign = 'left';
      g.fillText('LIVES', 22, 34);
      for (let i = 0; i < LIVES; i++) {
        const x = 86 + i * 26, on = i < S.lives;
        g.fillStyle = on ? '#f5841f' : 'rgba(255,255,255,.12)';
        g.beginPath(); g.ellipse(x, 35, 10, 8.5, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = on ? '#3d6b1c' : 'rgba(255,255,255,.12)';
        g.fillRect(x - 1.5, 24, 3, 5);
        if (on) {
          g.fillStyle = '#ffd24a';
          g.beginPath(); g.moveTo(x - 5, 33); g.lineTo(x - 2, 33); g.lineTo(x - 3.5, 30); g.closePath();
          g.moveTo(x + 2, 33); g.lineTo(x + 5, 33); g.lineTo(x + 3.5, 30); g.closePath();
          g.moveTo(x - 5, 37); g.quadraticCurveTo(x, 41, x + 5, 37); g.closePath();
          g.fill();
        }
      }
      const mult = Math.min(3, 1 + Math.floor(S.combo / 10));
      g.textAlign = 'right';
      g.font = `700 13px ${MONO}`;
      g.fillStyle = 'rgba(255,230,215,.6)';
      const runTxt = `IN A ROW ${S.combo}`;
      g.fillText(runTxt, W - 22 - (mult > 1 ? 40 : 0), 34);
      if (mult > 1) {
        g.font = `800 16px ${MONO}`;
        g.fillStyle = hsl(HUE + 20, 100, 66);
        g.fillText(`×${mult}`, W - 22, 34);
      }
      g.restore();
    }

    function draw() {
      const g = sf.g;
      sf.begin();
      if (!bg) bg = scenery();
      g.drawImage(bg, 0, 0, sf.w, sf.h);
      const { k, ox, oy } = view();
      g.save();
      const sh = S.shake > 0 && !reduced ? (Math.random() - 0.5) * 10 * S.shake : 0;
      g.translate(ox + sh, oy);
      g.scale(k, k);
      g.beginPath(); g.rect(-ox / k, -oy / k, sf.w / k, sf.h / k); g.clip();

      hud(g);
      for (const it of S.items) {
        if (it.st === 'got') continue;
        const a = it.st === 'landed' ? 1 - it.t / 0.7 : it.st === 'bounce' ? 1 - it.t / 0.8 : 1;
        g.save();
        g.globalAlpha = clamp(a, 0, 1);
        if (it.kind === 'spider') spider(g, it); else sweet(g, it);
        g.restore();
      }
      const tilt = clamp(S.bv / 780, -1, 1) * (reduced ? 0 : 0.12);
      const blink = S.hurtT > 0 && !reduced && Math.floor(S.hurtT * 12) % 2 === 0;
      bucket(g, S.bx, tilt, blink || S.state === 'dying');
      for (const q of S.parts) {
        g.fillStyle = hsl(q.hue, 100, 65, clamp(q.life / q.max, 0, 1));
        g.fillRect(q.x - q.s / 2, q.y - q.s / 2, q.s, q.s);
      }
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (const f of S.floats) {
        const a = clamp((f.life / f.max) * 1.6, 0, 1);
        g.font = `800 ${f.text.length > 6 ? 16 : 20}px ${FONT}`;
        g.fillStyle = f.hue ? hsl(f.hue, 100, 72, a) : `rgba(255,120,130,${a})`;
        g.fillText(f.text, f.x, f.y);
      }
      if (S.state === 'dying') {
        const a = clamp(S.dieT / 0.3, 0, 1);
        g.font = `900 54px ${FONT}`;
        g.fillStyle = `rgba(255,140,120,${a})`;
        g.shadowBlur = 24;
        g.shadowColor = `rgba(255,40,40,${a})`;
        g.fillText('BITTEN!', W / 2, H * 0.42);
        g.shadowBlur = 0;
      }
      g.restore();
      if (S.flash > 0) {
        g.fillStyle = `rgba(255,30,50,${S.flash * 0.22})`;
        g.fillRect(0, 0, sf.w, sf.h);
      }
      if (S.state === 'ready') {
        prompt(g, sf,
          coarse() ? 'Drag the bucket to catch the candy' : 'Move the bucket with the mouse or ← →',
          'Dodge the spiders — three bites and trick-or-treat is over', HUE, oy + (RIM - 150) * k);
      }
    }

    /* ------------------------------ input ------------------------------ */
    const toArena = e => {
      const r = sf.cv.getBoundingClientRect();
      const { k, ox } = view();
      return (e.clientX - r.left - ox) / k;
    };
    const DIRS = { ArrowLeft: 'left', ArrowRight: 'right', KeyA: 'left', KeyD: 'right' };
    const onKey = e => {
      if (!ownsKey(el, e)) return;
      const d = DIRS[e.code];
      if (d) {
        e.preventDefault();
        snd.wake();
        S.keys.add(d);
        begin();
        return;
      }
      if ((e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'ArrowDown') && S.state === 'ready') {
        e.preventDefault();
        snd.wake();
        begin();
      }
    };
    const onKeyUp = e => { const d = DIRS[e.code]; if (d) S.keys.delete(d); };
    const onBlur = () => S.keys.clear();
    let held = false;
    const onDown = e => {
      if (e.button > 0) return;
      e.preventDefault();
      snd.wake();
      held = true;
      try { sf.cv.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
      S.target = toArena(e);
      begin();
    };
    const onMove = e => {
      /* a mouse steers just by hovering; a finger while it is down */
      if (e.pointerType !== 'mouse' && !held) return;
      if (S.state === 'over') return;
      S.target = toArena(e);
    };
    const onUp = () => { held = false; };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    sf.cv.addEventListener('pointerdown', onDown);
    sf.cv.addEventListener('pointermove', onMove);
    sf.cv.addEventListener('pointerup', onUp);
    sf.cv.addEventListener('pointercancel', onUp);

    loop.start();

    return {
      stop() {
        loop.stop();
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onBlur);
        sf.cv.removeEventListener('pointerdown', onDown);
        sf.cv.removeEventListener('pointermove', onMove);
        sf.cv.removeEventListener('pointerup', onUp);
        sf.cv.removeEventListener('pointercancel', onUp);
        snd.close();
        sf.destroy();
      },
      pause() { S.paused = true; S.keys.clear(); loop.stop(); draw(); },
      resume() { S.paused = false; if (S.state !== 'over') loop.start(); },
      /* a read-only snapshot for automated play-tests (arena units) */
      peek: () => ({
        state: S.state, paused: S.paused, score: S.score, lives: S.lives, combo: S.combo,
        caught: S.caught, missed: S.missed, bitten: S.bitten, bucket: S.bx, W, H, rim: RIM, open: OPEN,
        items: S.items.filter(it => it.st === 'fall').map(it => ({ id: it.id, kind: it.kind, x: it.x, y: it.y, vy: it.vy })),
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
