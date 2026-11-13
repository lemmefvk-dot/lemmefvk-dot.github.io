/* ============================================================
   arcade/pong.js — Pong for Static Arcade.

   One player: you are the LEFT paddle against a computer that is
   deliberately beatable — it only reacts once the ball crosses
   into its side, aims with a random error that is re-rolled every
   time you hit and grows as a rally gets long (so a long, fast
   rally can beat it outright), and has a top speed that the ball
   outgrows (each paddle hit is ~5.5 % faster).

   Where the ball meets the paddle sets the angle, and a paddle that
   is moving when it hits adds spin — so aiming (not just blocking)
   is how you win points.

   Two players, same keyboard: left is W / S, right is ↑ / ↓. On a
   touch screen each half of the table drives its own paddle, so
   two thumbs work.

   In a tall play area (a phone held upright) the table turns: you
   play from the bottom and the computer (or player two) from the
   top, paddles move with ← → / A D or a sideways drag. The physics
   do not change — only the view and which keys mean "along the
   paddle's rail".

   First to 7. The score reported to the shell is your points in
   1P (0–7) or the winner's points in 2P. The table is a fixed
   800×500 arena scaled to fit, so play feels the same at any size.
   Follows the module contract in ./index.js.

   ONLINE (ctx.online, a friend on another device through the
   Arcade's room): each player sees themselves as the blue paddle
   on the left — the guest's picture is the host's mirrored — and
   moves it exactly as in 1P. Between hits the ball's path is pure
   geometry (a straight line folded off the walls), so both screens
   can draw it from the same few numbers. Whoever the ball is
   heading TOWARD decides what happens when it reaches them — they
   see their own paddle with no delay — and sends one event: 'hit'
   (the new path) or 'miss' (a point to the other player, and the
   next serve). The other screen holds the ball at that paddle until
   the event arrives, then catches up by half the round-trip time.

   The events are checked, not believed: a hit must start where the
   ball's path really crosses the sender's paddle line, at a speed
   the game can make; a miss can only ever give a point to the
   OTHER player (nobody can score for themselves); the serve must be
   the normal serve speed toward the player who conceded. Each event
   carries the running score and is repeated in every paddle update,
   so one lost message is repaired by the next. First to 7 wins.
   ============================================================ */

const HUE = 200;          /* you / left */
const CPU_HUE = 330;      /* the computer or player two */
const W = 800, H = 500;
const PW = 12, PH = 84, PX = 30, BR = 8;
const WIN = 7;
const KEY_SPEED = 560;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;
const FONT = 'Inter,ui-sans-serif,system-ui,sans-serif';
/* a touch screen is the main pointer: say "tap" and "swipe", not keys */
const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

export default {
  mount(el, ctx) {
    if (ctx.online && typeof ctx.online.send === 'function') return online(el, ctx);
    const two = ctx.players === 2;
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    const S = {
      state: 'ready',          /* ready | serve | play | over */
      paused: false,
      l: 0, r: 0,
      L: { y: H / 2, target: null, py: H / 2, v: 0 },
      R: { y: H / 2, target: null, py: H / 2, v: 0 },
      ball: { x: W / 2, y: H / 2, vx: 0, vy: 0, speed: 0 },
      serveT: 0, serveDir: -1,
      keys: new Set(),
      trail: [],
      err: 0, rally: 0,
      flash: 0, flashSide: 0,
      time: 0,
    };
    const sf = surface(el, two ? 'Pong, two players' : 'Pong against the computer', () => draw());
    const vert = () => isVert(sf);
    const view = () => viewOf(sf);
    report();

    function report() { ctx.onScore(two ? `${S.l} – ${S.r}` : S.l); }

    /* ------------------------------ rules ------------------------------ */
    function serve(delay = 0.8) {
      const b = S.ball;
      b.x = W / 2; b.y = H / 2; b.vx = 0; b.vy = 0;
      S.trail = [];
      S.state = 'serve';
      S.serveT = delay;
    }
    function launch() {
      const b = S.ball;
      const a = (Math.random() * 2 - 1) * 0.45;
      b.speed = 380;
      b.vx = Math.cos(a) * b.speed * S.serveDir;
      b.vy = Math.sin(a) * b.speed;
      S.rally = 0;
      S.err = (Math.random() * 2 - 1) * PH * 0.35;
      S.state = 'play';
    }
    function start() {
      if (S.state !== 'ready') return;
      serve(0.6);
    }

    function hit(P, dir) {
      const b = S.ball;
      const off = clamp((b.y - P.y) / (PH / 2 + BR), -1, 1);
      /* up to ~54° from where it hit, plus spin from a moving paddle */
      const ang = clamp(off * 0.95 + clamp(P.v / 1500, -0.3, 0.3), -1.05, 1.05);
      b.speed = Math.min(880, b.speed * 1.055);
      b.vx = Math.cos(ang) * b.speed * dir;
      b.vy = Math.sin(ang) * b.speed;
      b.x = dir > 0 ? PX + PW + BR : W - PX - PW - BR;
      S.rally++;
      /* the computer re-aims (imperfectly) every time you hit it back */
      if (dir > 0) S.err = (Math.random() * 2 - 1) * PH * (0.3 + Math.min(0.5, S.rally * 0.04));
      snd.blip(dir > 0 ? 520 : 440, 0.05, 'square', 0.9);
    }

    function point(side) {
      if (side === 'l') S.l++; else S.r++;
      report();
      S.flash = reduced ? 0 : 0.35;
      S.flashSide = side === 'l' ? 1 : -1;
      snd.blip(side === 'l' ? 880 : 300, 0.18, 'triangle', 1, side === 'l' ? 1320 : 180);
      if (S.l >= WIN || S.r >= WIN) { finish(); return; }
      S.serveDir = side === 'l' ? 1 : -1;      /* toward whoever just conceded */
      serve();
    }

    function finish() {
      S.state = 'over';
      S.ball.vx = S.ball.vy = 0;
      S.flash = 0;
      S.trail = [];
      draw();
      if (two) {
        const lead = S.l > S.r ? 'Left' : 'Right';
        ctx.onEnd({ score: Math.max(S.l, S.r), won: true, detail: `${lead} player wins ${Math.max(S.l, S.r)}–${Math.min(S.l, S.r)}` });
      } else {
        const won = S.l >= WIN;
        ctx.onEnd({ score: S.l, won, detail: `${won ? 'You beat the computer' : 'The computer won'} ${S.l}–${S.r}` });
      }
    }

    function drive(P, up, down, dt) {
      if (up || down) {
        P.target = null;
        P.y += ((down ? 1 : 0) - (up ? 1 : 0)) * KEY_SPEED * dt;
      } else if (P.target !== null) {
        const d = P.target - P.y;
        P.y += clamp(d, -950 * dt, 950 * dt);
      }
      P.y = clamp(P.y, PH / 2, H - PH / 2);
    }

    function cpu(dt) {
      const b = S.ball;
      let target = H / 2;
      if (S.state === 'play' && b.vx > 0 && b.x > W * 0.32) target = b.y + S.err;
      const max = 290 + Math.min(110, S.l * 10 + S.rally * 5);
      const d = target - S.R.y;
      if (Math.abs(d) > 5) S.R.y += clamp(d, -max * dt, max * dt);
      S.R.y = clamp(S.R.y, PH / 2, H - PH / 2);
    }

    function physics(dt) {
      const b = S.ball;
      const n = Math.max(1, Math.ceil((b.speed * dt) / 5));
      const h = dt / n;
      for (let i = 0; i < n && S.state === 'play'; i++) {
        b.x += b.vx * h;
        b.y += b.vy * h;
        if (b.y < BR) { b.y = BR; b.vy = Math.abs(b.vy); snd.blip(260, 0.03, 'square', 0.5); }
        if (b.y > H - BR) { b.y = H - BR; b.vy = -Math.abs(b.vy); snd.blip(260, 0.03, 'square', 0.5); }
        if (b.vx < 0 && b.x - BR <= PX + PW && b.x - BR >= PX - 10 && Math.abs(b.y - S.L.y) <= PH / 2 + BR) hit(S.L, 1);
        else if (b.vx > 0 && b.x + BR >= W - PX - PW && b.x + BR <= W - PX + 10 && Math.abs(b.y - S.R.y) <= PH / 2 + BR) hit(S.R, -1);
        if (b.x < -BR * 2) point('r');
        else if (b.x > W + BR * 2) point('l');
      }
    }

    /* ------------------------------ loop ------------------------------ */
    const loop = looper(dt => {
      S.time += dt;
      const k = S.keys;
      /* upright, the rail runs left → right on screen: A D / ← → too */
      const v = vert();
      const p1up = k.has('KeyW') || (v && k.has('KeyA')), p1down = k.has('KeyS') || (v && k.has('KeyD'));
      const p2up = k.has('ArrowUp') || (v && k.has('ArrowLeft')), p2down = k.has('ArrowDown') || (v && k.has('ArrowRight'));
      if (two) {
        drive(S.L, p1up, p1down, dt);
        drive(S.R, p2up, p2down, dt);
      } else {
        drive(S.L, p1up || p2up, p1down || p2down, dt);
        cpu(dt);
      }
      for (const P of [S.L, S.R]) {
        if (dt > 0) P.v = P.v * 0.5 + ((P.y - P.py) / dt) * 0.5;
        P.py = P.y;
      }
      if (S.state === 'serve') {
        S.serveT -= dt;
        if (S.serveT <= 0) launch();
      } else if (S.state === 'play') {
        physics(dt);
        if (!reduced) {
          S.trail.push({ x: S.ball.x, y: S.ball.y });
          if (S.trail.length > 10) S.trail.shift();
        }
      }
      if (S.flash > 0) S.flash = Math.max(0, S.flash - dt);
      draw();
      if (S.state === 'over') loop.stop();
    });

    /* ------------------------------ drawing ------------------------------ */
    function draw() {
      const g = sf.g;
      sf.begin();
      const v = view();
      const labels = two ? [v.vert ? 'P1 · A D' : 'P1 · W S', v.vert ? 'P2 · ← →' : 'P2 · ↑ ↓'] : ['YOU', 'CPU'];
      paintTable(g, sf, v, {
        flash: S.flash, flashSide: S.flashSide, l: S.l, r: S.r, labels,
        L: S.L.y, R: S.R.y, trail: S.trail,
        ball: S.state !== 'ready' && !(S.state === 'serve' && !reduced && Math.floor(S.serveT * 8) % 2 === 1) ? S.ball : null,
      });
      if (S.state === 'ready') {
        const touch = coarse();
        let how;
        if (touch) how = two ? 'Each player drags on their own half' : v.vert ? 'Drag left and right to move' : 'Drag up and down to move';
        else if (two) how = v.vert ? 'Bottom: A / D  ·  Top: ← / →' : 'Left: W / S  ·  Right: ↑ / ↓';
        else how = v.vert ? '← → or A / D, or move the mouse' : 'W / S or ↑ / ↓, or move the mouse';
        prompt(g, sf, touch ? 'Tap to serve' : 'Press Space or tap to serve', `${how}  ·  first to 7`, HUE);
      }
    }

    /* ------------------------------ input ------------------------------ */
    const MOVE = new Set(['KeyW', 'KeyS', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight']);
    const onKey = e => {
      if (!ownsKey(el, e)) return;
      if (MOVE.has(e.code)) {
        e.preventDefault();
        if (!S.paused) S.keys.add(e.code);
        snd.wake();
      } else if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        snd.wake();
        if (!S.paused) start();
      }
    };
    const onKeyUp = e => { S.keys.delete(e.code); };
    const onBlur = () => S.keys.clear();
    const toArena = e => arenaPoint(sf, e);
    const aimAt = e => {
      if (S.paused || S.state === 'over') return;
      const p = toArena(e);
      if (!two) S.L.target = p.y;
      else if (e.pointerType === 'mouse' && !e.buttons) return;
      else (p.x < W / 2 ? S.L : S.R).target = p.y;
    };
    const onDown = e => {
      snd.wake();
      aimAt(e);
      if (!S.paused) start();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    sf.cv.addEventListener('pointerdown', onDown);
    sf.cv.addEventListener('pointermove', aimAt);

    loop.start();

    return {
      stop() {
        loop.stop();
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onBlur);
        sf.cv.removeEventListener('pointerdown', onDown);
        sf.cv.removeEventListener('pointermove', aimAt);
        snd.close();
        sf.destroy();
      },
      pause() { S.paused = true; S.keys.clear(); loop.stop(); draw(); },
      resume() { S.paused = false; if (S.state !== 'over') loop.start(); },
      /* a read-only snapshot for automated play-tests (arena units) */
      peek: () => ({
        state: S.state, paused: S.paused, two, l: S.l, r: S.r, rally: S.rally,
        ball: { x: S.ball.x, y: S.ball.y, vx: S.ball.vx, vy: S.ball.vy, speed: S.ball.speed },
        left: S.L.y, right: S.R.y, arena: { W, H, PX, PW, PH, BR },
      }),
    };
  },
};

/* ============================================================
   The table, shared by every mode.
   ============================================================ */
/* upright table when the play area is clearly taller than wide */
const isVert = sf => sf.h > sf.w * 1.1;
function viewOf(sf) {
  if (isVert(sf)) {
    const k = Math.min(sf.w / H, sf.h / W) * 0.96;
    return { vert: true, k, ox: (sf.w - H * k) / 2, oy: (sf.h - W * k) / 2 };
  }
  const k = Math.min(sf.w / W, sf.h / H) * 0.96;
  return { vert: false, k, ox: (sf.w - W * k) / 2, oy: (sf.h - H * k) / 2 };
}
/* arena → screen: upright, arena x runs bottom → top and y left → right */
function toTable(g, v) {
  if (v.vert) { g.translate(v.ox, v.oy + W * v.k); g.rotate(-Math.PI / 2); }
  else g.translate(v.ox, v.oy);
  g.scale(v.k, v.k);
}
function arenaPoint(sf, e) {
  const r = sf.cv.getBoundingClientRect();
  const v = viewOf(sf);
  const px = e.clientX - r.left - v.ox, py = e.clientY - r.top - v.oy;
  return v.vert ? { x: W - py / v.k, y: px / v.k } : { x: px / v.k, y: py / v.k };
}

function paddle(g, x, y, hue) {
  g.save();
  g.shadowBlur = 18;
  g.shadowColor = hsl(hue, 100, 55, 0.9);
  g.fillStyle = hsl(hue, 100, 66);
  rr(g, x, y - PH / 2, PW, PH, 5);
  g.fill();
  g.restore();
  g.fillStyle = 'rgba(255,255,255,.55)';
  rr(g, x + 3, y - PH / 2 + 6, 2, PH - 12, 1);
  g.fill();
}

/* the two scores with who is who under them, at (lx,ly) and (rx,ry) */
function scores(g, T, lx, ly, rx, ry) {
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.font = `800 64px ${FONT}`;
  g.fillStyle = hsl(HUE, 100, 72, 0.9);
  g.fillText(String(T.l), lx, ly);
  g.fillStyle = hsl(CPU_HUE, 100, 72, 0.9);
  g.fillText(String(T.r), rx, ry);
  g.font = `600 13px ${FONT}`;
  g.fillStyle = 'rgba(220,235,255,.45)';
  g.fillText(T.labels[0], lx, ly + 22, 160);
  g.fillText(T.labels[1], rx, ry + 22, 160);
}

/* T = { flash, flashSide, l, r, labels:[left,right], L, R (paddle y), trail, ball: {x,y} | null } */
function paintTable(g, sf, v, T) {
  g.fillStyle = '#02060b';
  g.fillRect(0, 0, sf.w, sf.h);
  g.save();
  toTable(g, v);
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#061423');
  bg.addColorStop(1, '#040b14');
  g.fillStyle = bg;
  rr(g, 0, 0, W, H, 14);
  g.fill();
  g.strokeStyle = hsl(HUE, 90, 60, 0.22);
  g.lineWidth = 2;
  g.stroke();
  if (T.flash > 0) {
    const grd = g.createLinearGradient(T.flashSide > 0 ? W : 0, 0, W / 2, 0);
    grd.addColorStop(0, hsl(T.flashSide > 0 ? HUE : CPU_HUE, 100, 60, T.flash));
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
  }
  /* faint grid */
  g.strokeStyle = hsl(HUE, 80, 60, 0.05);
  g.lineWidth = 1;
  g.beginPath();
  for (let x = 50; x < W; x += 50) { g.moveTo(x, 0); g.lineTo(x, H); }
  for (let y = 50; y < H; y += 50) { g.moveTo(0, y); g.lineTo(W, y); }
  g.stroke();
  /* centre line */
  g.fillStyle = hsl(HUE, 90, 75, 0.28);
  for (let y = 10; y < H; y += 26) g.fillRect(W / 2 - 2, y, 4, 14);
  if (!v.vert) scores(g, T, W / 2 - 90, 84, W / 2 + 90, 84);
  g.restore();
  /* upright table: the numbers stay upright, beside the centre line */
  if (v.vert) {
    const x = v.ox + 74 * v.k, cy = v.oy + (W / 2) * v.k;
    g.save();
    g.translate(x, cy);
    g.scale(v.k, v.k);
    scores(g, T, 0, 82, 0, -62);
    g.restore();
  }
  g.save();
  toTable(g, v);
  paddle(g, PX, T.L, HUE);
  paddle(g, W - PX - PW, T.R, CPU_HUE);
  const n = T.trail.length;
  T.trail.forEach((p, i) => {
    g.fillStyle = hsl(HUE, 100, 80, (i / n) * 0.25);
    g.beginPath(); g.arc(p.x, p.y, BR * (0.4 + (i / n) * 0.5), 0, Math.PI * 2); g.fill();
  });
  if (T.ball) {
    g.save();
    g.shadowBlur = 20;
    g.shadowColor = hsl(HUE, 100, 70, 0.95);
    g.fillStyle = '#f2fbff';
    g.beginPath(); g.arc(T.ball.x, T.ball.y, BR, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  g.restore();
}

/* ============================================================
   Online: one match, two screens. See the header.
   Local frame: I am always LEFT. The wire speaks the host's frame
   (host left), so the guest mirrors x-velocities in and out.
   ============================================================ */
const PLANE_L = PX + PW + BR;           /* where the ball's centre meets my paddle */
const PLANE_R = W - PX - PW - BR;       /* … and theirs */
const SERVE_SPEED = 380, MAX_SPEED = 880;
const SERVE_DELAY = 1.0;                /* seconds the ball sits in the middle before a serve */
const FIRST_SERVE = 1.6;
const FLY_OUT = 0.35;
const Y_SLACK = 14;                     /* arena units a hit's y may differ from the path (rounding, frame timing) */

/* fold a straight path into the table between the walls */
function fold(y) {
  const lo = BR, span = H - 2 * BR;
  let u = (y - lo) % (2 * span);
  if (u < 0) u += 2 * span;
  return lo + (u <= span ? u : 2 * span - u);
}
const bounces = y => Math.floor((y - BR) / (H - 2 * BR));
const r2 = n => Math.round(n * 100) / 100;
const fin = (n, lo, hi) => typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi;

function online(el, ctx) {
  const NET = ctx.online;
  const host = NET.role === 'host';
  const reduced = !!ctx.reduced;
  const snd = sounder(ctx);
  const name = String(NET.peer?.name || 'Friend');
  const now = () => performance.now() / 1000;
  const vxOut = vx => (host ? vx : -vx);     /* local → wire (and back: it is its own inverse) */
  const scWire = (me, them) => (host ? [me, them] : [them, me]);
  const scLocal = sc => (host ? { me: sc[0], them: sc[1] } : { me: sc[1], them: sc[0] });
  const oneWay = () => clamp(((NET.rtt?.() ?? 120) / 2000), 0, 0.25);

  const S = {
    me: 0, them: 0, k: 0, rally: 0,
    L: { y: H / 2, target: null, py: H / 2, v: 0 },
    R: { y: H / 2, ty: H / 2 },
    ball: null,                   /* { x0, y0, vx, vy, t0, speed } — a path, see fold() */
    fly: null,                    /* the last ball, flying off after a miss */
    off: { x: 0, y: 0 },          /* drawn-ball correction that eases away */
    keys: new Set(), trail: [],
    flash: 0, flashSide: 0, over: false, ended: false,
    mine: null,                   /* my latest event, repeated in every paddle update */
    lastSent: 0, sentY: -1, bad: 0, hintUntil: 0,
  };
  const sf = surface(el, `Pong online against ${name}`, () => draw());

  /* the first serve comes from the shared seed: the same on both screens */
  {
    const seed = NET.seed >>> 0;
    const towardHost = (seed & 1) === 1;
    const a = (((seed >>> 1) % 1000) / 1000 * 2 - 1) * 0.45;
    const dir = (towardHost === host) ? -1 : 1;       /* toward me = left = -1 */
    S.ball = { x0: W / 2, y0: H / 2, vx: Math.cos(a) * SERVE_SPEED * dir, vy: Math.sin(a) * SERVE_SPEED, t0: now() + FIRST_SERVE, speed: SERVE_SPEED };
    S.hintUntil = now() + FIRST_SERVE;
  }
  report();

  function report() {
    ctx.onScore(S.me);
    NET.peerScore?.(S.them);
  }

  /* where the path puts the ball at time t (before t0 it waits at its start) */
  function pathAt(b, t) {
    const dt = Math.max(0, t - b.t0);
    return { x: b.x0 + b.vx * dt, y: fold(b.y0 + b.vy * dt), raw: b.y0 + b.vy * dt };
  }
  /* when (and where) the path reaches a paddle line */
  function crossing(b, plane) {
    const tc = b.t0 + (plane - b.x0) / b.vx;
    return { tc, y: fold(b.y0 + b.vy * (tc - b.t0)) };
  }
  const towardMe = b => b.vx < 0;

  function setBall(b, drawnBefore) {
    S.ball = b;
    /* glide from where the ball was drawn to where it now is */
    if (drawnBefore && !reduced) {
      const p = pathAt(b, now());
      S.off = { x: drawnBefore.x - p.x, y: drawnBefore.y - p.y };
    } else S.off = { x: 0, y: 0 };
  }

  /* ------------------------------ events ------------------------------ */
  function send(extra = {}) {
    S.lastSent = performance.now();
    S.sentY = S.L.y;
    NET.send({ t: 'p', y: r2(S.L.y), ...(S.mine ? { ev: S.mine } : {}), ...extra });
  }
  function myHit(tc, y) {
    const P = S.L;
    const off = clamp((y - P.y) / (PH / 2 + BR), -1, 1);
    const ang = clamp(off * 0.95 + clamp(P.v / 1500, -0.3, 0.3), -1.05, 1.05);
    const speed = Math.min(MAX_SPEED, S.ball.speed * 1.055);
    const vx = Math.cos(ang) * speed, vy = Math.sin(ang) * speed;
    S.k += 1;
    S.rally++;
    S.ball = { x0: PLANE_L, y0: y, vx, vy, t0: tc, speed };
    S.mine = { k: S.k, e: 'hit', y: r2(y), vx: r2(vxOut(vx)), vy: r2(vy), s: r2(speed), sc: scWire(S.me, S.them) };
    snd.blip(520, 0.05, 'square', 0.9);
    send();
  }
  function myMiss(tc, y) {
    S.k += 1;
    S.them += 1;
    S.fly = { ...S.ball, until: now() + FLY_OUT };
    const a = (Math.random() * 2 - 1) * 0.45;
    /* the serve goes toward whoever conceded — me */
    const vx = -Math.cos(a) * SERVE_SPEED, vy = Math.sin(a) * SERVE_SPEED;
    S.ball = { x0: W / 2, y0: H / 2, vx, vy, t0: now() + SERVE_DELAY, speed: SERVE_SPEED };
    S.off = { x: 0, y: 0 };
    S.rally = 0;
    S.mine = { k: S.k, e: 'miss', vx: r2(vxOut(vx)), vy: r2(vy), sc: scWire(S.me, S.them) };
    point(-1);
    send();
  }
  function point(side) {          /* side 1: I scored, -1: they did */
    S.flash = reduced ? 0 : 0.35;
    S.flashSide = side;
    S.trail = [];
    snd.blip(side > 0 ? 880 : 300, 0.18, 'triangle', 1, side > 0 ? 1320 : 180);
    report();
    if (S.me >= WIN || S.them >= WIN) end();
  }
  function end() {
    if (S.over) return;
    S.over = true;
    S.ball = null;
    draw();
    /* say the last event a few more times: it decides the match on their side too */
    setTimeout(() => { if (!S.ended) send(); }, 300);
    setTimeout(() => { if (!S.ended) send(); }, 1000);
    ctx.onEnd({ score: S.me, won: S.me > S.them, versus: { me: S.me, them: S.them }, detail: `You ${S.me} – ${S.them} ${name}` });
  }

  /* an event from them — checked before it is believed */
  function theirs(ev, drawn) {
    if (!ev || typeof ev !== 'object' || !Number.isInteger(ev.k) || ev.k <= S.k || ev.k > S.k + 50) return;
    if (!Array.isArray(ev.sc) || ev.sc.length !== 2 || !ev.sc.every(n => Number.isInteger(n) && n >= 0 && n <= WIN)) return reject();
    const sc = scLocal(ev.sc);
    const next = ev.k === S.k + 1;
    if (!fin(ev.vx, -MAX_SPEED - 1, MAX_SPEED + 1) || !fin(ev.vy, -MAX_SPEED - 1, MAX_SPEED + 1)) return reject();
    const vx = vxOut(ev.vx), vy = ev.vy;
    /* the next event can only come from them while the ball is heading their way */
    if (next && S.ball && towardMe(S.ball)) return reject();
    /* nobody scores for themselves: their own score never moves on their word */
    if (sc.them !== S.them || sc.me < S.me || sc.me > S.me + (next ? 0 : 3) + (ev.e === 'miss' ? 1 : 0)) return reject();
    if (ev.e === 'hit') {
      const sp = Math.hypot(vx, vy);
      if (!(vx < 0) || !fin(ev.y, BR - 1, H - BR + 1) || sp < SERVE_SPEED - 2 || sp > MAX_SPEED + 2 || !fin(ev.s, SERVE_SPEED - 2, MAX_SPEED + 2)) return reject();
      /* the ball must really have reached their paddle line there */
      if (next && S.ball && !towardMe(S.ball)) {
        const c = crossing(S.ball, PLANE_R);
        if (Math.abs(c.y - ev.y) > Y_SLACK) return reject();
      }
      S.k = ev.k;
      if (sc.me !== S.me) { S.me = sc.me; report(); }
      setBall({ x0: PLANE_R, y0: ev.y, vx, vy, t0: now() - oneWay(), speed: ev.s }, drawn);
      S.rally++;
      snd.blip(440, 0.05, 'square', 0.9);
    } else if (ev.e === 'miss') {
      const sp = Math.hypot(vx, vy);
      if (!(vx > 0) || Math.abs(sp - SERVE_SPEED) > 2 || (next && sc.me !== S.me + 1)) return reject();
      S.k = ev.k;
      const scored = sc.me - S.me;
      S.me = sc.me;
      if (drawn && S.ball) S.fly = { ...S.ball, x0: drawn.x, y0: drawn.y, t0: now(), until: now() + FLY_OUT };
      S.ball = { x0: W / 2, y0: H / 2, vx, vy, t0: now() - oneWay() + SERVE_DELAY, speed: SERVE_SPEED };
      S.off = { x: 0, y: 0 };
      S.rally = 0;
      if (scored > 0) point(1); else report();
    } else return reject();
  }
  function reject() { S.bad++; }

  function onNet(d) {
    if (S.ended || !d || d.t !== 'p') return;
    if (fin(d.y, -10, H + 10)) S.R.ty = clamp(d.y, PH / 2, H - PH / 2);
    if (d.ev && !S.over) theirs(d.ev, drawnBall());
  }

  /* ------------------------------ the frame ------------------------------ */
  let lastDrawn = null;
  const drawnBall = () => lastDrawn;

  function drive(P, up, down, dt) {
    if (up || down) {
      P.target = null;
      P.y += ((down ? 1 : 0) - (up ? 1 : 0)) * KEY_SPEED * dt;
    } else if (P.target !== null) {
      const d = P.target - P.y;
      P.y += clamp(d, -950 * dt, 950 * dt);
    }
    P.y = clamp(P.y, PH / 2, H - PH / 2);
  }

  const loop = looper(dt => {
    const t = now();
    const k = S.keys, vt = isVert(sf);
    const up = k.has('KeyW') || k.has('ArrowUp') || (vt && (k.has('KeyA') || k.has('ArrowLeft')));
    const down = k.has('KeyS') || k.has('ArrowDown') || (vt && (k.has('KeyD') || k.has('ArrowRight')));
    if (!S.over) drive(S.L, up, down, dt);
    if (dt > 0) S.L.v = S.L.v * 0.5 + ((S.L.y - S.L.py) / dt) * 0.5;
    S.L.py = S.L.y;
    S.R.y += (S.R.ty - S.R.y) * Math.min(1, dt * 18);

    const b = S.ball;
    if (b && !S.over && t >= b.t0) {
      if (towardMe(b)) {
        const c = crossing(b, PLANE_L);
        if (t >= c.tc) {
          if (Math.abs(c.y - S.L.y) <= PH / 2 + BR) myHit(c.tc, c.y);
          else myMiss(c.tc, c.y);
        }
      }
    }
    /* paddle updates: quick while moving, a heartbeat while still */
    const since = performance.now() - S.lastSent;
    if (!S.ended && ((Math.abs(S.L.y - S.sentY) > 0.5 && since > 66) || since > 300)) send();

    if (S.flash > 0) S.flash = Math.max(0, S.flash - dt);
    const ease = Math.exp(-dt * 14);
    S.off.x *= ease; S.off.y *= ease;
    draw();
    if (S.over) loop.stop();
  });

  /* the ball as it should be drawn now: held at their paddle while their word is on its way */
  function ballNow(t) {
    const b = S.ball;
    if (!b) return null;
    let p = pathAt(b, t);
    if (!towardMe(b)) {
      const c = crossing(b, PLANE_R);
      if (t >= c.tc) p = { x: PLANE_R, y: c.y };
    }
    return { x: p.x + S.off.x, y: p.y + S.off.y };
  }

  let lastBounce = null;
  function draw() {
    const g = sf.g;
    sf.begin();
    const t = now();
    const v = viewOf(sf);
    let ball = null;
    if (S.fly && t < S.fly.until) {
      const p = pathAt(S.fly, t);
      ball = { x: p.x, y: p.y };
    } else {
      S.fly = null;
      const serving = S.ball && t < S.ball.t0;
      ball = ballNow(t);
      if (serving && !reduced && Math.floor((S.ball.t0 - t) * 8) % 2 === 1) ball = null;
    }
    if (S.ball && !S.over && !(!towardMe(S.ball) && t >= crossing(S.ball, PLANE_R).tc)) {
      const nb = bounces(pathAt(S.ball, t).raw);
      if (lastBounce !== null && nb !== lastBounce && t > S.ball.t0) snd.blip(260, 0.03, 'square', 0.5);
      lastBounce = nb;
    }
    if (ball) lastDrawn = ball;
    if (ball && !reduced && S.ball && t >= S.ball.t0) {
      S.trail.push({ x: ball.x, y: ball.y });
      if (S.trail.length > 10) S.trail.shift();
    } else if (!ball) S.trail = [];
    paintTable(g, sf, v, {
      flash: S.flash, flashSide: S.flashSide, l: S.me, r: S.them,
      labels: ['YOU', name.toUpperCase().slice(0, 16)], L: S.L.y, R: S.R.y, trail: S.trail, ball: S.over ? null : ball,
    });
    if (t < S.hintUntil && !S.over) {
      const how = coarse() ? (v.vert ? 'Drag left and right to move' : 'Drag up and down to move')
        : v.vert ? '← → or A / D, or move the mouse' : 'W / S or ↑ / ↓, or move the mouse';
      prompt(g, sf, `You vs ${name} — first to 7`, `${how}  ·  you are the blue paddle`, HUE, v.oy + (v.vert ? W : H) * v.k * 0.72);
    }
  }

  /* ------------------------------ input ------------------------------ */
  const MOVE = new Set(['KeyW', 'KeyS', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight']);
  const onKey = e => {
    if (!ownsKey(el, e)) return;
    if (MOVE.has(e.code)) { e.preventDefault(); S.keys.add(e.code); snd.wake(); }
    else if (e.code === 'Space') { e.preventDefault(); snd.wake(); }
  };
  const onKeyUp = e => { S.keys.delete(e.code); };
  const onBlur = () => S.keys.clear();
  const aim = e => { if (!S.over) S.L.target = arenaPoint(sf, e).y; };
  const onDown = e => { snd.wake(); aim(e); };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  sf.cv.addEventListener('pointerdown', onDown);
  sf.cv.addEventListener('pointermove', aim);
  const offNet = NET.on?.(onNet) || null;
  send();
  loop.start();

  return {
    stop() {
      S.ended = true;
      loop.stop();
      try { offNet?.(); } catch (err) { /* already off */ }
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      sf.cv.removeEventListener('pointerdown', onDown);
      sf.cv.removeEventListener('pointermove', aim);
      snd.close();
      sf.destroy();
    },
    /* a read-only snapshot for automated play-tests (arena units, my frame) */
    peek: () => {
      const t = now();
      const b = S.ball;
      return {
        online: true, role: NET.role, me: S.me, them: S.them, k: S.k, over: S.over, rally: S.rally, rejected: S.bad,
        left: S.L.y, right: S.R.y, serving: !!b && t < b.t0,
        ball: b ? { ...pathAt(b, t), vx: b.vx, vy: b.vy, speed: b.speed, towardMe: towardMe(b) } : null,
        meet: b && towardMe(b) ? crossing(b, PLANE_L) : null,
        meetIn: b && towardMe(b) ? crossing(b, PLANE_L).tc - t : null,
        arena: { W, H, PX, PW, PH, BR },
      };
    },
  };
}

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
