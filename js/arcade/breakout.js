/* ============================================================
   arcade/breakout.js — Breakout for Static Arcade.

   Clear the wall. Clearing every brick moves you to the next level,
   which brings a new layout (ten of them, then round again), a
   faster ball and, from level 3, bricks that take two hits (from
   level 6, three). Levels keep coming, so the score is simply how far
   you get: higher rows are worth more, tough bricks pay per hit.

   Lives are the mode (ctx.mode; each keeps its own best): three
   (the usual), one, or five.

   Power-ups: now and then a broken brick drops a capsule. Catch it
   with the paddle:
     W  wide paddle for 15 s
     M  multi-ball: every ball in play splits in three
     S  slow ball: the balls slow down for 10 s
   A life goes only when the last ball in play is lost; a new life,
   a new level or the end of the round clears what was running.

   Paddle: the mouse or a finger anywhere over the table, or ← → /
   A D. Mouse sensitivity (ctx.settings.sens, Options) scales how far
   the paddle goes for a move of the pointer, around the middle of the
   table: ×1 follows the pointer exactly, ×1.5 crosses the table with a
   smaller move, ×0.6 gives finer control. Launch with Space, ↑, a
   click or a tap. The table is an 800-wide arena scaled to fit: 600
   tall, or up to 900 in a tall play area (a phone held upright),
   fixed for the round. Balls move in small sub-steps so none tunnels
   through a brick at high speed.
   Follows the module contract in ./index.js.
   ============================================================ */

const HUE = 20;
const W = 800;
const COLS = 10, MARGIN = 36, GAP = 6, BH = 22, TOP = 78;
const PAD_H = 14, BALL_R = 7, PAD_W = 112, WIDE_W = 168;
const LIVES = { three: 3, one: 1, five: 5 };
const MAX_BALLS = 9;
const WIDE_SECS = 15, SLOW_SECS = 10, SLOW_K = 0.68, DROP_CHANCE = 0.12, CAP_V = 150;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;
const FONT = 'Inter,ui-sans-serif,system-ui,sans-serif';
const MONO = '"JetBrains Mono",ui-monospace,Menlo,Consolas,monospace';
/* a touch screen is the main pointer: say "tap" and "swipe", not keys */
const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/* warm neon rows, top to bottom */
const ROW_HUES = [330, 345, 0, 14, 28, 40, 52, 64];

/* which cells of a rows×COLS wall hold a brick, per level (then round again) */
const INVADER = ['..#....#..', '...#..#...', '..######..', '.##.##.##.', '##########', '#.######.#', '#.#....#.#', '...##.##..'];
const LAYOUTS = [
  (r, c) => r < 6,                                              /* full wall */
  (r, c) => r < 7 && (r + c) % 2 === 0,                         /* checker */
  (r, c) => r < 8 && Math.abs(c - 4.5) <= 5 - (r * 0.62),       /* inverted pyramid */
  (r, c) => r < 7 && c % 3 !== 2,                               /* columns */
  (r, c) => r < 8 && (Math.abs(c - 4.5) + Math.abs(r - 3.5)) <= 5.2, /* diamond */
  (r, c) => r < 8 && (r === 0 || r === 7 || c === 0 || c === 9 || ((r === 3 || r === 4) && c > 2 && c < 7)), /* frame round a core */
  (r, c) => r < 8 && Math.abs(((c + r) % 6) - 2.5) <= 1,        /* zigzag */
  (r, c) => INVADER[r]?.[c] === '#',                            /* an invader */
  (r, c) => r < 8 && r % 2 === 0 && (c + (r % 4 ? 1 : 0)) % 5 !== 0, /* stripes with gaps */
  (r, c) => r < 7 && (c < 4 || c > 5) && (r < 2 || c % 2 === r % 2), /* two towers */
];
const POWERS = {
  wide: { letter: 'W', hue: 195, name: 'Wide paddle' },
  multi: { letter: 'M', hue: 300, name: 'Multi-ball' },
  slow: { letter: 'S', hue: 140, name: 'Slow ball' },
};
const POWER_KINDS = Object.keys(POWERS);

export default {
  mount(el, ctx) {
    const reduced = !!ctx.reduced;
    const pace = Number.isFinite(ctx.speed) ? clamp(ctx.speed, 0.5, 1) : 1;   /* the Arcade's game speed: the whole clock runs at this rate */
    const MODE = LIVES[ctx.mode] ? ctx.mode : 'three', LIVES0 = LIVES[MODE];
    const sens = () => clamp(Number(ctx.settings?.sens) || 1, 0.4, 2.5);
    const snd = sounder(ctx);
    const sf = surface(el, 'Breakout table', () => draw());
    /* the table's height follows the play area's shape, once per round */
    const H = sf.w > 40 && sf.h > 40 ? clamp(Math.round((W * sf.h) / sf.w / 20) * 20, 600, 900) : 600;
    const PAD_Y = H - 52;
    const S = {
      state: 'serve',          /* serve (ball on paddle) | play | clear | over */
      paused: false,
      score: 0, lives: LIVES0, level: 1, broken: 0,
      pad: { x: W / 2, w: PAD_W, target: null },
      balls: [newBall()],
      bricks: [], caps: [],
      wideT: 0, slowT: 0, caught: { wide: 0, multi: 0, slow: 0 }, dropped: 0,
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
    function newBall() { return { x: W / 2, y: PAD_Y - BALL_R, vx: 0, vy: 0, speed: 0 }; }
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

    /* one ball back on the paddle; whatever was running stops */
    function stick() {
      S.state = 'serve';
      S.balls = [newBall()];
      S.caps = [];
      S.wideT = 0; S.slowT = 0; S.pad.w = PAD_W;
    }

    function baseSpeed() { return Math.min(760, 370 + (S.level - 1) * 38); }
    /* a ball's speed right now: its own, slowed while Slow ball runs */
    const vel = b => b.speed * (S.slowT > 0 ? SLOW_K : 1);

    function launch() {
      if (S.state !== 'serve' || S.paused) return;
      const b = S.balls[0];
      const a = (Math.random() * 2 - 1) * 0.35;
      b.speed = baseSpeed();
      b.vx = Math.sin(a);
      b.vy = -Math.cos(a);
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

    function hitBrick(br, b) {
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
        b.speed = Math.min(baseSpeed() * 1.25, b.speed * 1.012);
        if (Math.random() < DROP_CHANCE) drop(br.x + br.w / 2, br.y + br.h / 2, POWER_KINDS[Math.floor(Math.random() * POWER_KINDS.length)]);
      }
      ctx.onScore(S.score);
    }
    function drop(x, y, kind) { S.caps.push({ x, y, kind }); S.dropped++; }

    /* a capsule reached the paddle */
    function catchCap(kind) {
      S.caught[kind]++;
      if (kind === 'wide') { S.wideT = WIDE_SECS; }
      else if (kind === 'slow') { S.slowT = SLOW_SECS; }
      else if (kind === 'multi') {
        const out = [];
        for (const b of S.balls) {
          out.push(b);
          if (S.state !== 'play') continue;
          const a = Math.atan2(b.vx, -b.vy);
          for (const da of [-0.45, 0.45]) {
            if (S.balls.length + out.length > MAX_BALLS) break;
            const na = clamp(a + da, -1.1, 1.1);
            out.push({ x: b.x, y: b.y, vx: Math.sin(na), vy: -Math.cos(na), speed: b.speed });
          }
        }
        S.balls = out.slice(0, MAX_BALLS);
      }
      snd.blip(880, 0.12, 'triangle', 0.8, 1320);
    }

    function moveBall(b, dt) {
      const p = S.pad;
      const v = vel(b);
      const n = Math.max(1, Math.ceil((v * dt) / 4));
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        const px = b.x, py = b.y;
        b.x += b.vx * v * h;
        b.y += b.vy * v * h;
        if (b.x < BALL_R) { b.x = BALL_R; b.vx = Math.abs(b.vx); snd.blip(240, 0.03, 'square', 0.4); }
        if (b.x > W - BALL_R) { b.x = W - BALL_R; b.vx = -Math.abs(b.vx); snd.blip(240, 0.03, 'square', 0.4); }
        if (b.y < BALL_R) { b.y = BALL_R; b.vy = Math.abs(b.vy); snd.blip(240, 0.03, 'square', 0.4); }

        /* paddle */
        if (b.vy > 0 && b.y + BALL_R >= PAD_Y && py + BALL_R <= PAD_Y + 4 && Math.abs(b.x - p.x) <= p.w / 2 + BALL_R) {
          const off = clamp((b.x - p.x) / (p.w / 2), -1, 1);
          const a = off * 1.05;                        /* up to ~60° */
          b.vx = Math.sin(a);
          b.vy = -Math.cos(a);
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
          hitBrick(br, b);
          break;
        }
        /* the direction stays a unit vector; never let it settle into a flat, endless sideways bounce */
        const m = Math.hypot(b.vx, b.vy) || 1;
        b.vx /= m; b.vy /= m;
        if (Math.abs(b.vy) < 0.22) {
          b.vy = Math.sign(b.vy || -1) * 0.22;
          b.vx = Math.sign(b.vx || 1) * Math.sqrt(1 - b.vy * b.vy);
        }
        if (b.y > H + BALL_R * 3) { b.lost = true; return; }
      }
    }

    function physics(dt) {
      for (const b of S.balls) if (!b.lost) moveBall(b, dt);
      S.balls = S.balls.filter(b => !b.lost);
      if (!S.balls.length) { lose(); return; }
      /* capsules fall; the paddle catches them */
      const p = S.pad;
      for (const c of S.caps) {
        c.y += CAP_V * dt;
        if (c.y + 8 >= PAD_Y && c.y - 8 <= PAD_Y + PAD_H && Math.abs(c.x - p.x) <= p.w / 2 + 16) { c.done = true; catchCap(c.kind); }
        else if (c.y > H + 20) c.done = true;
      }
      S.caps = S.caps.filter(c => !c.done);
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
        S.balls = [];
        draw();
        const got = Object.entries(S.caught).filter(([, n]) => n).map(([k, n]) => `${n} ${POWERS[k].name.toLowerCase()}`);
        ctx.onEnd({
          score: S.score, won: false,
          detail: `Reached level ${S.level} · ${S.broken} brick${S.broken === 1 ? '' : 's'} broken${got.length ? ` · caught ${got.join(', ')}` : ''}`,
        });
        return;
      }
      stick();
    }

    /* ------------------------------ loop ------------------------------ */
    const loop = looper(dt0 => {
      const dt = dt0 * pace;
      S.time += dt;
      const p = S.pad;
      /* Wide paddle grows and shrinks back smoothly */
      if (S.wideT > 0) S.wideT = Math.max(0, S.wideT - dt);
      if (S.slowT > 0) S.slowT = Math.max(0, S.slowT - dt);
      const wantW = S.wideT > 0 ? WIDE_W : PAD_W;
      p.w += clamp(wantW - p.w, -240 * dt, 240 * dt);
      const left = S.keys.has('ArrowLeft') || S.keys.has('KeyA');
      const right = S.keys.has('ArrowRight') || S.keys.has('KeyD');
      if (left || right) { p.target = null; p.x += ((right ? 1 : 0) - (left ? 1 : 0)) * 780 * dt; }
      else if (p.target !== null) p.x += clamp(p.target - p.x, -1600 * dt, 1600 * dt);
      p.x = clamp(p.x, p.w / 2, W - p.w / 2);

      if (S.state === 'serve') { const b = S.balls[0]; b.x = p.x; b.y = PAD_Y - BALL_R; }
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

      /* top strip: lives, what is running, level */
      g.textBaseline = 'middle';
      g.font = `700 14px ${MONO}`;
      g.fillStyle = 'rgba(255,230,215,.55)';
      g.textAlign = 'left';
      g.fillText('LIVES', 22, 36);
      for (let i = 0; i < LIVES0; i++) {
        g.fillStyle = i < S.lives ? hsl(HUE, 100, 65) : 'rgba(255,255,255,.12)';
        g.beginPath(); g.arc(88 + i * 20, 36, 6, 0, Math.PI * 2); g.fill();
      }
      let rx = 88 + LIVES0 * 20 + 18;
      for (const [kind, t, max] of [['wide', S.wideT, WIDE_SECS], ['slow', S.slowT, SLOW_SECS]]) {
        if (t <= 0) continue;
        capsule(g, rx + 14, 36, kind, 0.9);
        g.fillStyle = 'rgba(255,255,255,.15)'; g.fillRect(rx, 47, 28, 3);
        g.fillStyle = hsl(POWERS[kind].hue, 100, 65); g.fillRect(rx, 47, 28 * t / max, 3);
        rx += 40;
      }
      if (S.balls.length > 1) { g.fillStyle = hsl(POWERS.multi.hue, 100, 75); g.font = `700 13px ${MONO}`; g.fillText(`×${S.balls.length}`, rx, 36); }
      g.font = `700 14px ${MONO}`;
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

      /* capsules on their way down */
      for (const c of S.caps) capsule(g, c.x, c.y, c.kind, 1);

      /* paddle */
      const p = S.pad;
      g.save();
      g.shadowBlur = 20;
      g.shadowColor = S.wideT > 0 ? hsl(POWERS.wide.hue, 100, 60, 0.9) : hsl(HUE, 100, 55, 0.9);
      const pg = g.createLinearGradient(0, PAD_Y, 0, PAD_Y + PAD_H);
      pg.addColorStop(0, hsl(HUE + 15, 100, 72));
      pg.addColorStop(1, hsl(HUE, 100, 50));
      g.fillStyle = pg;
      rr(g, p.x - p.w / 2, PAD_Y, p.w, PAD_H, 7);
      g.fill();
      g.restore();

      /* balls */
      for (const b of S.balls) {
        g.save();
        g.shadowBlur = 18;
        g.shadowColor = S.slowT > 0 ? hsl(POWERS.slow.hue, 100, 65, 0.95) : hsl(45, 100, 70, 0.95);
        g.fillStyle = '#fff6e6';
        g.beginPath(); g.arc(b.x, b.y, BALL_R, 0, Math.PI * 2); g.fill();
        g.restore();
      }

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
        const lives = `${LIVES0} ${LIVES0 === 1 ? 'life' : 'lives'}`;
        prompt(g, sf, touch ? 'Tap to launch' : 'Space, click or tap to launch', touch ? `Drag to move the paddle  ·  ${lives}` : `Mouse, finger or ← → to move  ·  ${lives}  ·  catch W M S`, HUE, oy + (PAD_Y - 118) * k);
      }
    }

    /* a power-up capsule: a lit pill with its letter */
    function capsule(g, x, y, kind, a) {
      const P = POWERS[kind];
      g.save();
      g.globalAlpha = a;
      g.shadowBlur = reduced ? 0 : 12;
      g.shadowColor = hsl(P.hue, 100, 60, 0.9);
      const cg = g.createLinearGradient(0, y - 8, 0, y + 8);
      cg.addColorStop(0, hsl(P.hue, 95, 70));
      cg.addColorStop(1, hsl(P.hue, 90, 42));
      g.fillStyle = cg;
      rr(g, x - 16, y - 8, 32, 16, 8);
      g.fill();
      g.shadowBlur = 0;
      g.fillStyle = 'rgba(255,255,255,.35)';
      g.fillRect(x - 10, y - 6, 20, 2);
      g.fillStyle = '#0b0610';
      g.font = `800 11px ${MONO}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(P.letter, x, y + 1);
      g.restore();
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
    /* where the pointer puts the paddle: the pointer's x on the table, scaled round the middle by the sensitivity */
    const aimAt = clientX => {
      const r = sf.cv.getBoundingClientRect();
      const { k, ox } = view();
      return W / 2 + ((clientX - r.left - ox) / k - W / 2) * sens();
    };
    const aim = e => {
      if (S.paused || S.state === 'over') return;
      S.pad.target = aimAt(e.clientX);
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
      /* what a watcher may see (./spectate.js 'bricks'): the 8 × 10 wall as hits left ('0' gone),
         the paddle and the first ball in play, in whole arena units */
      spectate: () => {
        const wall = Array(8 * COLS).fill('0');
        const bw = (W - MARGIN * 2 - GAP * (COLS - 1)) / COLS;
        for (const br of S.bricks) {
          if (!br.alive) continue;
          const r = Math.round((br.y - TOP) / (BH + GAP)), c = Math.round((br.x - MARGIN) / (bw + GAP));
          if (r >= 0 && r < 8 && c >= 0 && c < COLS) wall[r * COLS + c] = String(Math.max(1, Math.min(3, br.hp)));
        }
        return { k: 'bricks', h: H, wall: wall.join(''), pad: [Math.round(S.pad.x), Math.round(S.pad.w)], ball: (b => [Math.round(b.x), Math.round(b.y)])(S.balls[0] || { x: 0, y: 0 }),
          lv: S.level, lives: Math.max(0, S.lives), score: S.score, txt: S.state === 'over' ? 'Game over' : S.paused ? 'Paused' : `Level ${S.level}`, over: S.state === 'over' };
      },
      /* a read-only snapshot for automated play-tests (arena units; `ball` is the first ball in play) */
      peek: () => {
        const b = S.balls[0] || { x: 0, y: 0, vx: 0, vy: 0, speed: 0 };
        const v = vel(b);
        return {
          state: S.state, paused: S.paused, score: S.score, lives: S.lives, level: S.level, broken: S.broken, mode: MODE, livesAtStart: LIVES0,
          bricks: S.bricks.filter(x => x.alive).length, layouts: LAYOUTS.length,
          targets: S.bricks.filter(x => x.alive).sort((p, q) => q.y - p.y).slice(0, 4).map(x => ({ x: x.x + x.w / 2, y: x.y + x.h })),
          ball: { x: b.x, y: b.y, vx: b.vx * v, vy: b.vy * v }, balls: S.balls.map(q => ({ x: q.x, y: q.y, v: vel(q) })), pad: { x: S.pad.x, w: S.pad.w, target: S.pad.target },
          caps: S.caps.map(c => ({ kind: c.kind, x: c.x, y: c.y })), dropped: S.dropped, wide: S.wideT, slow: S.slowT, caught: { ...S.caught }, sens: sens(),
          arena: { W, H, PAD_Y, BALL_R }, time: S.time, pace,
          view: (() => { const vv = view(); const r = sf.cv.getBoundingClientRect(); return { k: vv.k, ox: vv.ox + r.left, oy: vv.oy + r.top }; })(),
        };
      },
      /* test hook — nothing in the game calls it: drop({ kind, x, y }) a capsule · clear() every brick but one ·
         ball({ x, y, vx, vy }) put the first ball there, moving */
      hook(cmd, arg) {
        if (cmd === 'drop') drop(arg.x, arg.y, arg.kind);
        else if (cmd === 'clear') { let left = 1; for (const br of S.bricks) { if (br.alive && left-- <= 0) br.alive = false; } }
        else if (cmd === 'ball') { const b = S.balls[0]; Object.assign(b, { x: arg.x, y: arg.y }); const m = Math.hypot(arg.vx, arg.vy) || 1; b.vx = arg.vx / m; b.vy = arg.vy / m; b.speed = m; S.state = 'play'; }
        else return false;
        draw();
        return true;
      },
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
