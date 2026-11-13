/* ============================================================
   arcade/breakout.js — Breakout for Static Arcade.

   Clear the wall. Three lives; clearing every brick moves you to
   the next level, which brings a new layout, a faster ball and,
   from level 3, bricks that take two hits (from level 6, three).
   Levels keep coming, so the score is simply how far you get:
   higher rows are worth more, tough bricks pay per hit.

   Paddle: the mouse or a finger anywhere over the table, or ← → /
   A D. Launch the ball with Space, ↑, a click or a tap. The table
   is an 800-wide arena scaled to fit: 600 tall, or up to 900 in a
   tall play area (a phone held upright), fixed for the round. The
   ball moves in small sub-steps so it never tunnels through a brick
   at high speed.
   Follows the module contract in ./index.js.
   ============================================================ */

const HUE = 20;
const W = 800;
const COLS = 10, MARGIN = 36, GAP = 6, BH = 22, TOP = 78;
const PAD_H = 14, BALL_R = 7;
const LIVES = 3;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;
const FONT = 'Inter,ui-sans-serif,system-ui,sans-serif';
const MONO = '"JetBrains Mono",ui-monospace,Menlo,Consolas,monospace';
/* a touch screen is the main pointer: say "tap" and "swipe", not keys */
const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/* warm neon rows, top to bottom */
const ROW_HUES = [330, 345, 0, 14, 28, 40, 52, 64];

/* which cells of a rows×COLS wall hold a brick, per level */
const LAYOUTS = [
  (r, c) => r < 6,                                              /* full wall */
  (r, c) => r < 7 && (r + c) % 2 === 0,                         /* checker */
  (r, c) => r < 8 && Math.abs(c - 4.5) <= 5 - (r * 0.62),       /* inverted pyramid */
  (r, c) => r < 7 && c % 3 !== 2,                               /* columns */
  (r, c) => r < 8 && (Math.abs(c - 4.5) + Math.abs(r - 3.5)) <= 5.2, /* diamond */
];

export default {
  mount(el, ctx) {
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    const sf = surface(el, 'Breakout table', () => draw());
    /* the table's height follows the play area's shape, once per round */
    const H = sf.w > 40 && sf.h > 40 ? clamp(Math.round((W * sf.h) / sf.w / 20) * 20, 600, 900) : 600;
    const PAD_Y = H - 52;
    const S = {
      state: 'serve',          /* serve (ball on paddle) | play | clear | over */
      paused: false,
      score: 0, lives: LIVES, level: 1, broken: 0,
      pad: { x: W / 2, w: 112, target: null },
      ball: { x: W / 2, y: PAD_Y - BALL_R, vx: 0, vy: 0, speed: 0 },
      bricks: [],
      keys: new Set(),
      parts: [], banner: 0, shake: 0, time: 0,
      clearT: 0,
    };
    const view = () => {
      const k = Math.min(sf.w / W, sf.h / H) * 0.97;
      return { k, ox: (sf.w - W * k) / 2, oy: (sf.h - H * k) / 2 };
    };

    buildLevel();
    ctx.onScore(0);

    /* ------------------------------ rules ------------------------------ */
    function buildLevel() {
      const shape = LAYOUTS[(S.level - 1) % LAYOUTS.length];
      const bw = (W - MARGIN * 2 - GAP * (COLS - 1)) / COLS;
      const rows = 8;
      S.bricks = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < COLS; c++) {
        if (!shape(r, c)) continue;
        const hp = S.level >= 6 && r < 2 ? 3 : S.level >= 3 && r < 2 ? 2 : 1;
        S.bricks.push({
          x: MARGIN + c * (bw + GAP), y: TOP + r * (BH + GAP), w: bw, h: BH,
          hp, max: hp, hue: ROW_HUES[r % ROW_HUES.length], pts: (rows - r) * 10, alive: true,
        });
      }
      S.banner = 1.4;
      stick();
    }

    function stick() {
      S.state = 'serve';
      S.ball.vx = S.ball.vy = 0;
      S.ball.speed = 0;
    }

    function baseSpeed() { return Math.min(760, 370 + (S.level - 1) * 38); }

    function launch() {
      if (S.state !== 'serve' || S.paused) return;
      const b = S.ball;
      const a = (Math.random() * 2 - 1) * 0.35;
      b.speed = baseSpeed();
      b.vx = Math.sin(a) * b.speed;
      b.vy = -Math.cos(a) * b.speed;
      S.state = 'play';
      snd.blip(520, 0.05, 'square', 0.7);
    }

    function burst(x, y, hue) {
      if (reduced) return;
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * Math.PI * 2, v = 60 + Math.random() * 200;
        S.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life: 0.45 + Math.random() * 0.3, hue });
      }
    }

    function hitBrick(br) {
      br.hp--;
      if (br.hp > 0) {
        S.score += 5;
        snd.blip(300, 0.04, 'square', 0.7);
      } else {
        br.alive = false;
        S.score += br.pts * br.max;
        S.broken++;
        burst(br.x + br.w / 2, br.y + br.h / 2, br.hue);
        snd.blip(640 + (8 - Math.floor((br.y - TOP) / (BH + GAP))) * 60, 0.05, 'square', 0.8);
        /* the ball speeds up a little as the wall thins */
        S.ball.speed = Math.min(baseSpeed() * 1.25, S.ball.speed * 1.012);
      }
      ctx.onScore(S.score);
    }

    function physics(dt) {
      const b = S.ball, p = S.pad;
      const n = Math.max(1, Math.ceil((b.speed * dt) / 4));
      const h = dt / n;
      for (let i = 0; i < n && S.state === 'play'; i++) {
        const px = b.x, py = b.y;
        b.x += b.vx * h;
        b.y += b.vy * h;
        if (b.x < BALL_R) { b.x = BALL_R; b.vx = Math.abs(b.vx); snd.blip(240, 0.03, 'square', 0.4); }
        if (b.x > W - BALL_R) { b.x = W - BALL_R; b.vx = -Math.abs(b.vx); snd.blip(240, 0.03, 'square', 0.4); }
        if (b.y < BALL_R) { b.y = BALL_R; b.vy = Math.abs(b.vy); snd.blip(240, 0.03, 'square', 0.4); }

        /* paddle */
        if (b.vy > 0 && b.y + BALL_R >= PAD_Y && py + BALL_R <= PAD_Y + 4 && Math.abs(b.x - p.x) <= p.w / 2 + BALL_R) {
          const off = clamp((b.x - p.x) / (p.w / 2), -1, 1);
          const a = off * 1.05;                        /* up to ~60° */
          b.vx = Math.sin(a) * b.speed;
          b.vy = -Math.cos(a) * b.speed;
          b.y = PAD_Y - BALL_R;
          snd.blip(420, 0.04, 'square', 0.6);
        }

        /* bricks: one per sub-step, reflect on the axis we came in from */
        for (const br of S.bricks) {
          if (!br.alive) continue;
          const nx = clamp(b.x, br.x, br.x + br.w), ny = clamp(b.y, br.y, br.y + br.h);
          if ((b.x - nx) ** 2 + (b.y - ny) ** 2 > BALL_R * BALL_R) continue;
          const wasBeside = px + BALL_R <= br.x || px - BALL_R >= br.x + br.w;
          const wasAbove = py + BALL_R <= br.y || py - BALL_R >= br.y + br.h;
          if (wasBeside && !wasAbove) b.vx = -b.vx;
          else if (wasAbove && !wasBeside) b.vy = -b.vy;
          else { b.vx = -b.vx; b.vy = -b.vy; }
          b.x = px; b.y = py;
          hitBrick(br);
          break;
        }
        /* keep the speed exact after a bump */
        const m = Math.hypot(b.vx, b.vy) || 1;
        b.vx = (b.vx / m) * b.speed;
        b.vy = (b.vy / m) * b.speed;
        /* never let it settle into a flat, endless sideways bounce */
        if (Math.abs(b.vy) < b.speed * 0.22) {
          b.vy = Math.sign(b.vy || -1) * b.speed * 0.22;
          b.vx = Math.sign(b.vx || 1) * Math.sqrt(b.speed * b.speed - b.vy * b.vy);
        }

        if (b.y > H + BALL_R * 3) { lose(); return; }
      }
      if (!S.bricks.some(br => br.alive)) {
        S.state = 'clear';
        S.clearT = 1.1;
        snd.blip(660, 0.3, 'triangle', 1, 1320);
      }
    }

    function lose() {
      S.lives--;
      S.shake = reduced ? 0 : 0.3;
      snd.blip(200, 0.3, 'sawtooth', 0.9, 70);
      if (S.lives <= 0) {
        S.state = 'over';
        draw();
        ctx.onEnd({
          score: S.score, won: false,
          detail: `Reached level ${S.level} · ${S.broken} brick${S.broken === 1 ? '' : 's'} broken`,
        });
        return;
      }
      stick();
    }

    /* ------------------------------ loop ------------------------------ */
    const loop = looper(dt => {
      S.time += dt;
      const p = S.pad;
      const left = S.keys.has('ArrowLeft') || S.keys.has('KeyA');
      const right = S.keys.has('ArrowRight') || S.keys.has('KeyD');
      if (left || right) { p.target = null; p.x += ((right ? 1 : 0) - (left ? 1 : 0)) * 780 * dt; }
      else if (p.target !== null) p.x += clamp(p.target - p.x, -1600 * dt, 1600 * dt);
      p.x = clamp(p.x, p.w / 2, W - p.w / 2);

      if (S.state === 'serve') { S.ball.x = p.x; S.ball.y = PAD_Y - BALL_R; }
      else if (S.state === 'play') physics(dt);
      else if (S.state === 'clear') {
        S.clearT -= dt;
        if (S.clearT <= 0) { S.level++; buildLevel(); }
      }
      for (const q of S.parts) { q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 500 * dt; q.life -= dt; }
      S.parts = S.parts.filter(q => q.life > 0);
      if (S.banner > 0) S.banner = Math.max(0, S.banner - dt);
      if (S.shake > 0) S.shake = Math.max(0, S.shake - dt);
      draw();
      if (S.state === 'over') loop.stop();
    });

    /* ------------------------------ drawing ------------------------------ */
    function draw() {
      const g = sf.g;
      sf.begin();
      g.fillStyle = '#070403';
      g.fillRect(0, 0, sf.w, sf.h);
      const { k, ox, oy } = view();
      g.save();
      const sx = S.shake > 0 ? (Math.random() - 0.5) * 8 * S.shake / 0.3 : 0;
      g.translate(ox + sx, oy);
      g.scale(k, k);

      const bg = g.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#140905');
      bg.addColorStop(1, '#0a0503');
      g.fillStyle = bg;
      rr(g, 0, 0, W, H, 14);
      g.fill();
      g.strokeStyle = hsl(HUE, 100, 60, 0.22);
      g.lineWidth = 2;
      g.stroke();
      /* a soft glow from below, where the paddle lives */
      const glow = g.createRadialGradient(W / 2, H + 40, 10, W / 2, H + 40, 420);
      glow.addColorStop(0, hsl(HUE, 100, 55, 0.18));
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = glow;
      g.fillRect(0, 0, W, H);

      /* top strip: lives + level */
      g.textBaseline = 'middle';
      g.font = `700 14px ${MONO}`;
      g.fillStyle = 'rgba(255,230,215,.55)';
      g.textAlign = 'left';
      g.fillText('LIVES', 22, 36);
      for (let i = 0; i < LIVES; i++) {
        g.fillStyle = i < S.lives ? hsl(HUE, 100, 65) : 'rgba(255,255,255,.12)';
        g.beginPath(); g.arc(88 + i * 20, 36, 6, 0, Math.PI * 2); g.fill();
      }
      g.textAlign = 'right';
      g.fillStyle = 'rgba(255,230,215,.55)';
      g.fillText(`LEVEL ${S.level}`, W - 22, 36);

      /* bricks */
      for (const br of S.bricks) {
        if (!br.alive) continue;
        const l = br.hp === br.max ? 58 : 44;
        g.save();
        g.shadowBlur = 12;
        g.shadowColor = hsl(br.hue, 100, 55, 0.55);
        g.fillStyle = hsl(br.hue, 92, l);
        rr(g, br.x, br.y, br.w, br.h, 4);
        g.fill();
        g.restore();
        g.fillStyle = 'rgba(255,255,255,.28)';
        g.fillRect(br.x + 4, br.y + 3, br.w - 8, 3);
        if (br.max > 1) {
          g.strokeStyle = 'rgba(20,6,2,.75)';
          g.lineWidth = 2;
          for (let i = 0; i < br.hp; i++) {
            const cx = br.x + br.w / 2 + (i - (br.hp - 1) / 2) * 10;
            g.beginPath(); g.arc(cx, br.y + br.h / 2 + 1, 3, 0, Math.PI * 2); g.stroke();
          }
        }
      }

      /* paddle */
      const p = S.pad;
      g.save();
      g.shadowBlur = 20;
      g.shadowColor = hsl(HUE, 100, 55, 0.9);
      const pg = g.createLinearGradient(0, PAD_Y, 0, PAD_Y + PAD_H);
      pg.addColorStop(0, hsl(HUE + 15, 100, 72));
      pg.addColorStop(1, hsl(HUE, 100, 50));
      g.fillStyle = pg;
      rr(g, p.x - p.w / 2, PAD_Y, p.w, PAD_H, 7);
      g.fill();
      g.restore();

      /* ball */
      const b = S.ball;
      g.save();
      g.shadowBlur = 18;
      g.shadowColor = hsl(45, 100, 70, 0.95);
      g.fillStyle = '#fff6e6';
      g.beginPath(); g.arc(b.x, b.y, BALL_R, 0, Math.PI * 2); g.fill();
      g.restore();

      for (const q of S.parts) {
        g.fillStyle = hsl(q.hue, 100, 65, clamp(q.life * 2, 0, 1));
        g.fillRect(q.x - 2, q.y - 2, 4, 4);
      }

      if (S.banner > 0 || S.state === 'clear') {
        const a = S.state === 'clear' ? 1 : clamp(S.banner / 0.4, 0, 1);
        g.textAlign = 'center';
        g.font = `800 44px ${FONT}`;
        g.fillStyle = hsl(HUE + 20, 100, 70, a);
        g.shadowBlur = 24;
        g.shadowColor = hsl(HUE, 100, 55, a);
        g.fillText(S.state === 'clear' ? 'WALL CLEARED' : `LEVEL ${S.level}`, W / 2, 360 + (H - 600) / 2);
        g.shadowBlur = 0;
      }
      g.restore();

      if (S.state === 'serve' && S.banner <= 0.2) {
        const touch = coarse();
        prompt(g, sf, touch ? 'Tap to launch' : 'Space, click or tap to launch', touch ? 'Drag to move the paddle  ·  3 lives' : 'Mouse, finger or ← → to move  ·  3 lives', HUE, oy + (PAD_Y - 118) * k);
      }
    }

    /* ------------------------------ input ------------------------------ */
    const MOVE = new Set(['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD']);
    const onKey = e => {
      if (!ownsKey(el, e)) return;
      if (MOVE.has(e.code)) { e.preventDefault(); if (!S.paused) S.keys.add(e.code); snd.wake(); }
      else if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
        e.preventDefault();
        snd.wake();
        launch();
      }
    };
    const onKeyUp = e => { S.keys.delete(e.code); };
    const onBlur = () => S.keys.clear();
    const aim = e => {
      if (S.paused || S.state === 'over') return;
      const r = sf.cv.getBoundingClientRect();
      const { k, ox } = view();
      S.pad.target = (e.clientX - r.left - ox) / k;
    };
    const onDown = e => {
      snd.wake();
      aim(e);
      try { sf.cv.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
      launch();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    sf.cv.addEventListener('pointerdown', onDown);
    sf.cv.addEventListener('pointermove', aim);

    loop.start();

    return {
      stop() {
        loop.stop();
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onBlur);
        sf.cv.removeEventListener('pointerdown', onDown);
        sf.cv.removeEventListener('pointermove', aim);
        snd.close();
        sf.destroy();
      },
      pause() { S.paused = true; S.keys.clear(); loop.stop(); draw(); },
      resume() { S.paused = false; if (S.state !== 'over') loop.start(); },
      /* a read-only snapshot for automated play-tests (arena units) */
      peek: () => ({
        state: S.state, paused: S.paused, score: S.score, lives: S.lives, level: S.level, broken: S.broken,
        bricks: S.bricks.filter(b => b.alive).length,
        targets: S.bricks.filter(b => b.alive).sort((p, q) => q.y - p.y).slice(0, 4).map(b => ({ x: b.x + b.w / 2, y: b.y + b.h })),
        ball: { x: S.ball.x, y: S.ball.y, vx: S.ball.vx, vy: S.ball.vy }, pad: { x: S.pad.x, w: S.pad.w },
        arena: { W, H, PAD_Y, BALL_R },
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
   from a gesture) and closed in stop(). Silent while ctx.sound is off. */
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
    blip(freq, dur = 0.07, type = 'square', vol = 1, to = 0) {
      const c = get();
      if (!c || c.state !== 'running') return;
      try {
        const t = c.currentTime, o = c.createOscillator(), gn = c.createGain();
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
