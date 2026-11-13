/* ============================================================
   arcade/maze.js — Haunted Maze for Static Arcade.

   A new maze every round, and it is dark. Your lantern lights a
   small circle around you; corridors you have already walked stay
   faintly remembered. Somewhere on the outer wall is a door with a
   green light behind it — reaching it ends the run.

   · Score = seconds from your first step to the door (lower is
     better; one decimal). The result also says how many steps you
     took against the shortest way out.
   · The maze is always 19 × 13 cells (13 × 19 in a tall window),
     so times are comparable between rounds and window sizes. It
     is a "perfect" maze with a few walls knocked through, so there
     are some loops; the door is the edge cell farthest from where
     you start.
   · The door's light shows through the dark once you are within a
     few cells of it.

   Input: arrow keys / WASD — tap to move one cell, hold to keep
   going (a turn you hold is taken at the next opening). A
   controller works through the Arcade's gamepad bridge. On touch
   (or with the mouse): press and drag like a joystick, or tap on
   a side of your lantern to step that way.

   The run only ends at the door: there is nothing to lose to, so
   the shell's pause and restart are the only other ways out. The
   end is reported through ctx.onEnd → the Arcade's 'arcade:score'
   (game 'haunted-maze', won: true).

   Follows the module contract in ./index.js; stop() removes every
   listener, the frame loop and the audio context.
   ============================================================ */

const HUE = 150;
const SPEED = 5.2;                 /* cells per second */
const LIGHT = 3.2;                 /* lantern radius, in cells */
const SEE = 4.8;                   /* the door glows through the dark within this */
const N = 1, E = 2, S_ = 4, W_ = 8;
const DIRS = [
  { bit: N, dx: 0, dy: -1, back: S_, name: 'up' },
  { bit: E, dx: 1, dy: 0, back: W_, name: 'right' },
  { bit: S_, dx: 0, dy: 1, back: N, name: 'down' },
  { bit: W_, dx: -1, dy: 0, back: E, name: 'left' },
];
const byName = Object.fromEntries(DIRS.map(d => [d.name, d]));

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;
const FONT = 'Inter,ui-sans-serif,system-ui,sans-serif';
const MONO = '"JetBrains Mono",ui-monospace,Menlo,Consolas,monospace';
/* a touch screen is the main pointer: say "drag", not keys */
const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

/* ---------------- the maze ---------------- */
function build(cols, rows) {
  const n = cols * rows;
  const open = new Uint8Array(n);
  const seen = new Uint8Array(n);
  const start = (rows - 1) * cols;            /* bottom-left corner */
  const stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const c = stack[stack.length - 1];
    const x = c % cols, y = (c / cols) | 0;
    const next = DIRS.filter(d => {
      const nx = x + d.dx, ny = y + d.dy;
      return nx >= 0 && ny >= 0 && nx < cols && ny < rows && !seen[ny * cols + nx];
    });
    if (!next.length) { stack.pop(); continue; }
    const d = next[Math.floor(Math.random() * next.length)];
    const o = (y + d.dy) * cols + (x + d.dx);
    open[c] |= d.bit;
    open[o] |= d.back;
    seen[o] = 1;
    stack.push(o);
  }
  /* knock a few walls through, so it is not one long corridor */
  const extra = Math.round(n * 0.06);
  for (let i = 0, tries = 0; i < extra && tries < n * 4; tries++) {
    const c = Math.floor(Math.random() * n);
    const x = c % cols, y = (c / cols) | 0;
    const d = DIRS[Math.floor(Math.random() * 4)];
    const nx = x + d.dx, ny = y + d.dy;
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || open[c] & d.bit) continue;
    open[c] |= d.bit;
    open[ny * cols + nx] |= d.back;
    i++;
  }
  const dist = bfs(open, cols, rows, start);
  /* the door: the edge cell farthest from the start */
  let exit = start, far = -1;
  for (let c = 0; c < n; c++) {
    const x = c % cols, y = (c / cols) | 0;
    if (x !== 0 && y !== 0 && x !== cols - 1 && y !== rows - 1) continue;
    if (dist[c] > far) { far = dist[c]; exit = c; }
  }
  const ex = exit % cols, ey = (exit / cols) | 0;
  const side = ey === 0 ? 'up' : ex === cols - 1 ? 'right' : ex === 0 ? 'left' : 'down';
  return { cols, rows, open, start, exit, side, shortest: far };
}

function bfs(open, cols, rows, from) {
  const dist = new Int32Array(cols * rows).fill(-1);
  dist[from] = 0;
  const q = [from];
  for (let i = 0; i < q.length; i++) {
    const c = q[i], x = c % cols, y = (c / cols) | 0;
    for (const d of DIRS) {
      if (!(open[c] & d.bit)) continue;
      const o = (y + d.dy) * cols + (x + d.dx);
      if (dist[o] < 0) { dist[o] = dist[c] + 1; q.push(o); }
    }
  }
  return dist;
}

export default {
  mount(el, ctx) {
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    let mapCv = null, fogCv = null, memCv = null, memDirty = true;
    const sf = surface(el, 'Haunted Maze — a dark maze lit by your lantern', () => { mapCv = null; fogCv = null; memCv = null; memDirty = true; draw(); });
    const tall = sf.h > sf.w * 1.05;
    const M = build(tall ? 13 : 19, tall ? 19 : 13);
    const sx = M.start % M.cols, sy = (M.start / M.cols) | 0;
    const S = {
      state: 'ready',              /* ready | play | escape | over */
      paused: false,
      x: sx + 0.5, y: sy + 0.5, dir: null, face: byName.right,
      held: [], tap: null, joy: null,
      t: 0, time: 0, steps: 0, escT: 0,
      seen: new Uint8Array(M.cols * M.rows),
      flick: 1, flickT: 3 + Math.random() * 4, dip: 0,
      wisps: Array.from({ length: 3 }, (_, i) => ({ x: Math.random() * M.cols, y: Math.random() * M.rows, vx: (Math.random() - 0.5) * 0.7, vy: (Math.random() - 0.5) * 0.5, ph: i * 2.1 })),
      parts: [],
    };
    const cellOf = () => Math.floor(S.y) * M.cols + Math.floor(S.x);
    const ex = M.exit % M.cols, ey = (M.exit / M.cols) | 0;
    reveal();
    ctx.onScore(0);

    /* where the maze sits on screen */
    function lay() {
      const top = 60, pad = 14;
      const c = Math.max(6, Math.floor(Math.min((sf.w - pad * 2) / M.cols, (sf.h - top - pad) / M.rows)));
      const mw = c * M.cols, mh = c * M.rows;
      return { c, ox: Math.round((sf.w - mw) / 2), oy: Math.round(top + (sf.h - top - pad - mh) / 2), mw, mh };
    }

    /* ------------------------------ rules ------------------------------ */
    function reveal() {
      const cx = Math.floor(S.x), cy = Math.floor(S.y);
      const r = 2;
      for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
        if (x < 0 || y < 0 || x >= M.cols || y >= M.rows) continue;
        if (Math.hypot(x - cx, y - cy) > r + 0.3) continue;
        const i = y * M.cols + x;
        if (!S.seen[i]) { S.seen[i] = 1; memDirty = true; }
      }
    }

    const want = () => S.joy || (S.held.length ? S.held[S.held.length - 1] : null) || S.tap;
    const atCentre = () => Math.abs(S.x - Math.floor(S.x) - 0.5) < 1e-6 && Math.abs(S.y - Math.floor(S.y) - 0.5) < 1e-6;

    function step(dt) {
      let move = SPEED * dt;
      let guard = 0;
      while (move > 1e-9 && guard++ < 8) {
        const w = want();
        if (atCentre()) {
          const c = cellOf();
          if (w && M.open[c] & w.bit) { S.dir = w; if (w === S.tap) S.tap = null; }
          else if (S.dir && w && M.open[c] & S.dir.bit && (S.held.length || S.joy)) { /* keep going until the held turn opens up */ }
          else { if (w === S.tap) S.tap = null; S.dir = null; return; }
          if (S.state === 'ready') begin();
          S.face = S.dir;
        } else if (w && S.dir && w.dx === -S.dir.dx && w.dy === -S.dir.dy) {
          S.dir = w;                       /* turning back is allowed mid-corridor */
          S.face = w;
          if (w === S.tap) S.tap = null;
        }
        if (!S.dir) return;
        /* distance to the next cell centre along dir */
        const fx = S.x - 0.5, fy = S.y - 0.5;
        const left = S.dir.dx ? (S.dir.dx > 0 ? Math.floor(fx) + 1 - fx : fx - Math.ceil(fx) + 1) : (S.dir.dy > 0 ? Math.floor(fy) + 1 - fy : fy - Math.ceil(fy) + 1);
        const toNext = left > 1e-6 ? left : 1;
        const d = Math.min(move, toNext);
        const before = cellOf();
        S.x += S.dir.dx * d;
        S.y += S.dir.dy * d;
        move -= d;
        if (d >= toNext - 1e-9) {
          S.x = Math.round(S.x - 0.5) + 0.5;
          S.y = Math.round(S.y - 0.5) + 0.5;
        }
        const now = cellOf();
        if (now !== before) {
          S.steps++;
          reveal();
          if (!reduced) S.parts.push({ x: S.x - S.dir.dx * 0.3, y: S.y - S.dir.dy * 0.3 + 0.25, life: 0.6 });
          snd.blip(S.steps % 2 ? 120 : 110, 0.05, 'triangle', 0.35);
        }
        if (atCentre() && cellOf() === M.exit && S.state === 'play') { escape(); return; }
      }
    }

    function begin() {
      if (S.state !== 'ready') return;
      S.state = 'play';
    }

    function escape() {
      S.state = 'escape';
      S.escT = 0;
      S.dir = null;
      S.face = byName[M.side];
      snd.blip(523, 0.12, 'triangle', 0.8);
      snd.blip(659, 0.12, 'triangle', 0.8, 0, 0.1);
      snd.blip(784, 0.12, 'triangle', 0.8, 0, 0.2);
      snd.blip(1047, 0.3, 'triangle', 0.8, 0, 0.3);
    }

    /* ------------------------------ loop ------------------------------ */
    const loop = looper(dt => {
      S.time += dt;
      if (S.state === 'ready' || S.state === 'play') step(dt);
      if (S.state === 'play') {
        S.t += dt;
        const tenths = Math.floor(S.t * 10);
        if (tenths !== S.shown) { S.shown = tenths; ctx.onScore(Math.round(S.t * 10) / 10); }
      } else if (S.state === 'escape') {
        S.escT += dt;
        const d = byName[M.side];
        if (S.escT < 0.6) { S.x += d.dx * dt * 1.2; S.y += d.dy * dt * 1.2; }
        if (S.escT >= 1.1) {
          S.state = 'over';
          const secs = Math.round(S.t * 10) / 10;
          ctx.onScore(secs);
          ctx.onEnd({
            score: secs, won: true,
            detail: `Escaped in ${secs.toFixed(1)} s · ${S.steps} steps (the shortest way out is ${M.shortest}) · ${M.cols}×${M.rows} maze`,
            steps: S.steps, shortest: M.shortest,
          });
        }
      }
      /* the lantern flickers now and then */
      if (!reduced) {
        S.flickT -= dt;
        if (S.flickT <= 0) { S.dip = 0.22; S.flickT = 3 + Math.random() * 6; }
        if (S.dip > 0) S.dip = Math.max(0, S.dip - dt);
        S.flick = 1 - (S.dip > 0 ? 0.25 * Math.abs(Math.sin(S.dip * 60)) : 0) + Math.sin(S.time * 7.3) * 0.015 + Math.sin(S.time * 13.1) * 0.01;
        for (const w of S.wisps) {
          w.x += w.vx * dt; w.y += w.vy * dt;
          if (w.x < -1 || w.x > M.cols + 1) w.vx *= -1;
          if (w.y < -1 || w.y > M.rows + 1) w.vy *= -1;
        }
      }
      for (const p of S.parts) p.life -= dt;
      S.parts = S.parts.filter(p => p.life > 0);
      draw();
      if (S.state === 'over') loop.stop();
    });

    /* ------------------------------ drawing ------------------------------ */
    const canvasLike = () => {
      const c = document.createElement('canvas');
      c.width = Math.round(sf.w * sf.dpr); c.height = Math.round(sf.h * sf.dpr);
      const g = c.getContext('2d');
      g.setTransform(sf.dpr, 0, 0, sf.dpr, 0, 0);
      return [c, g];
    };

    function paintMap() {
      const [c, g] = canvasLike();
      const L = lay(), k = L.c;
      const X = x => L.ox + x * k, Y = y => L.oy + y * k;
      /* surroundings: a dark stone backdrop */
      const back = g.createRadialGradient(sf.w / 2, sf.h / 2, 0, sf.w / 2, sf.h / 2, Math.max(sf.w, sf.h) * 0.7);
      back.addColorStop(0, '#0b0f0d');
      back.addColorStop(1, '#040605');
      g.fillStyle = back;
      g.fillRect(0, 0, sf.w, sf.h);
      /* floor tiles */
      for (let y = 0; y < M.rows; y++) for (let x = 0; x < M.cols; x++) {
        const i = y * M.cols + x;
        const v = hash(i * 3.7);
        g.fillStyle = hsl(28 + v * 22, 14, 15 + v * 6);
        g.fillRect(X(x), Y(y), k, k);
        g.fillStyle = 'rgba(0,0,0,.28)';
        g.fillRect(X(x) + k / 2 - 0.5, Y(y), 1, k);
        g.fillRect(X(x), Y(y) + k / 2 - 0.5, k, 1);
        if (hash(i + 0.5) < 0.12) {
          g.fillStyle = hsl(HUE - 20, 40, 20, 0.6);
          g.beginPath(); g.ellipse(X(x) + k * hash(i + 1), Y(y) + k * hash(i + 2), k * 0.18, k * 0.08, hash(i) * 3, 0, Math.PI * 2); g.fill();
        }
      }
      /* cobwebs in dead ends, in the corner away from the way in */
      g.strokeStyle = 'rgba(220,220,235,.32)';
      g.lineWidth = 1;
      for (let i = 0; i < M.open.length; i++) {
        const o = M.open[i];
        const n = (o & N ? 1 : 0) + (o & E ? 1 : 0) + (o & S_ ? 1 : 0) + (o & W_ ? 1 : 0);
        if (n !== 1 || i === M.start || i === M.exit || hash(i + 9) < 0.35) continue;
        const x = i % M.cols, y = (i / M.cols) | 0;
        const cxr = o & E ? 0 : 1, cyr = o & S_ ? 0 : o & N ? 1 : hash(i) < 0.5 ? 0 : 1;
        const px = X(x + cxr), py = Y(y + cyr), sxs = cxr ? -1 : 1, sys = cyr ? -1 : 1;
        const R = k * 0.55;
        g.beginPath();
        for (let a = 0; a <= 3; a++) {
          const t = (a / 3) * Math.PI / 2;
          g.moveTo(px, py); g.lineTo(px + sxs * Math.cos(t) * R, py + sys * Math.sin(t) * R);
        }
        for (const f of [0.35, 0.65, 0.95]) {
          g.moveTo(px + sxs * R * f, py);
          for (let a = 1; a <= 3; a++) {
            const t = (a / 3) * Math.PI / 2;
            g.quadraticCurveTo(px + sxs * Math.cos(t - 0.26) * R * f * 0.8, py + sys * Math.sin(t - 0.26) * R * f * 0.8, px + sxs * Math.cos(t) * R * f, py + sys * Math.sin(t) * R * f);
          }
        }
        g.stroke();
      }
      /* walls: dark stone with a lit top edge */
      const wt = Math.max(3, k * 0.22);
      const wall = (x1, y1, x2, y2) => {
        const x = Math.min(x1, x2) - wt / 2, y = Math.min(y1, y2) - wt / 2, w = Math.abs(x2 - x1) + wt, hh = Math.abs(y2 - y1) + wt;
        g.fillStyle = 'rgba(0,0,0,.45)';
        g.fillRect(x + 1, y + wt * 0.5, w, hh);
        g.fillStyle = '#2b2638';
        g.fillRect(x, y, w, hh);
        g.fillStyle = 'rgba(225,210,255,.30)';
        g.fillRect(x, y, w, Math.max(1, wt * 0.3));
      };
      for (let y = 0; y < M.rows; y++) for (let x = 0; x < M.cols; x++) {
        const o = M.open[y * M.cols + x];
        if (!(o & N)) wall(X(x), Y(y), X(x + 1), Y(y));
        if (!(o & W_)) wall(X(x), Y(y), X(x), Y(y + 1));
        if (x === M.cols - 1 && !(o & E)) wall(X(x + 1), Y(y), X(x + 1), Y(y + 1));
        if (y === M.rows - 1 && !(o & S_)) wall(X(x), Y(y + 1), X(x + 1), Y(y + 1));
      }
      /* the door: a gap in the outer wall with an arch */
      const d = byName[M.side];
      const cx = X(ex + 0.5) + d.dx * k * 0.5, cy = Y(ey + 0.5) + d.dy * k * 0.5;
      g.save();
      g.translate(cx, cy);
      g.rotate(Math.atan2(d.dy, d.dx) - Math.PI / 2 + Math.PI);
      g.fillStyle = '#081a10';
      g.fillRect(-k * 0.42, -wt, k * 0.84, wt * 2);
      g.strokeStyle = hsl(HUE, 80, 55, 0.9);
      g.lineWidth = Math.max(1.5, k * 0.06);
      g.beginPath(); g.moveTo(-k * 0.42, -wt); g.lineTo(k * 0.42, -wt); g.stroke();
      g.restore();
      /* where you came in */
      g.fillStyle = 'rgba(255,190,110,.10)';
      g.fillRect(X(sx) + 2, Y(sy) + 2, k - 4, k - 4);
      return c;
    }

    function pumpkin(g, x, y, r, face) {
      g.save();
      g.translate(x, y);
      g.shadowBlur = r * 1.2;
      g.shadowColor = 'rgba(255,150,40,.85)';
      const b = g.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r * 1.1);
      b.addColorStop(0, '#ffb25a');
      b.addColorStop(0.7, '#f07812');
      b.addColorStop(1, '#a3400a');
      g.fillStyle = b;
      g.beginPath(); g.ellipse(0, 0, r * 1.08, r, 0, 0, Math.PI * 2); g.fill();
      g.shadowBlur = 0;
      g.strokeStyle = 'rgba(120,40,0,.45)';
      g.lineWidth = Math.max(1, r * 0.08);
      g.beginPath(); g.ellipse(0, 0, r * 0.45, r * 0.98, 0, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#3d6b1c';
      g.fillRect(-r * 0.12, -r * 1.25, r * 0.24, r * 0.38);
      const fx = (face?.dx || 0) * r * 0.22, fy = (face?.dy || 0) * r * 0.18;
      g.fillStyle = '#ffe27a';
      g.shadowBlur = r * 0.6;
      g.shadowColor = 'rgba(255,220,90,1)';
      g.beginPath();
      g.moveTo(fx - r * 0.55, fy - r * 0.05); g.lineTo(fx - r * 0.18, fy - r * 0.05); g.lineTo(fx - r * 0.36, fy - r * 0.42); g.closePath();
      g.moveTo(fx + r * 0.18, fy - r * 0.05); g.lineTo(fx + r * 0.55, fy - r * 0.05); g.lineTo(fx + r * 0.36, fy - r * 0.42); g.closePath();
      g.moveTo(fx - r * 0.55, fy + r * 0.25); g.quadraticCurveTo(fx, fy + r * 0.78, fx + r * 0.55, fy + r * 0.25); g.quadraticCurveTo(fx, fy + r * 0.45, fx - r * 0.55, fy + r * 0.25);
      g.fill();
      g.restore();
    }

    function hud(g) {
      const pill = (x, label, value, alignRight) => {
        g.save();
        g.font = `800 17px ${MONO}`;
        const vw = g.measureText(value).width;
        g.font = `700 10px ${MONO}`;
        const lw = g.measureText(label).width;
        const w = vw + lw + 36;
        const px = alignRight ? x - w : x;
        g.fillStyle = 'rgba(4,8,6,.78)';
        g.strokeStyle = hsl(HUE, 80, 60, 0.35);
        g.lineWidth = 1;
        rr(g, px, 16, w, 32, 10);
        g.fill(); g.stroke();
        g.textBaseline = 'middle';
        g.textAlign = 'left';
        g.fillStyle = 'rgba(210,240,225,.55)';
        g.fillText(label, px + 12, 33);
        g.font = `800 17px ${MONO}`;
        g.fillStyle = '#eafff4';
        g.textAlign = 'right';
        g.fillText(value, px + w - 12, 33);
        g.restore();
      };
      const t = S.t;
      const m = Math.floor(t / 60), s = t - m * 60;
      pill(16, 'TIME', `${m}:${s.toFixed(1).padStart(4, '0')}`, false);
      pill(sf.w - 16, 'STEPS', String(S.steps), true);
    }

    function draw() {
      const g = sf.g;
      sf.begin();
      if (!mapCv) mapCv = paintMap();
      const L = lay(), k = L.c;
      const X = x => L.ox + x * k, Y = y => L.oy + y * k;
      g.drawImage(mapCv, 0, 0, sf.w, sf.h);

      /* footprints fading behind you */
      for (const p of S.parts) {
        g.fillStyle = `rgba(255,190,120,${p.life * 0.2})`;
        g.beginPath(); g.arc(X(p.x), Y(p.y), k * 0.06, 0, Math.PI * 2); g.fill();
      }

      /* the dark, with the remembered map and the lantern cut out of it */
      if (!fogCv) { fogCv = canvasLike(); memDirty = true; }
      if (!memCv) memCv = canvasLike();
      const [fc, fg] = fogCv;
      if (memDirty) {
        const [mc, mg] = memCv;
        mg.setTransform(1, 0, 0, 1, 0, 0);
        mg.clearRect(0, 0, mc.width, mc.height);
        mg.setTransform(sf.dpr, 0, 0, sf.dpr, 0, 0);
        mg.fillStyle = '#fff';
        for (let i = 0; i < S.seen.length; i++) {
          if (!S.seen[i]) continue;
          const x = i % M.cols, y = (i / M.cols) | 0;
          mg.fillRect(X(x) - 1, Y(y) - 1, k + 2, k + 2);
        }
        memDirty = false;
      }
      fg.setTransform(1, 0, 0, 1, 0, 0);
      fg.globalCompositeOperation = 'source-over';
      fg.clearRect(0, 0, fc.width, fc.height);
      fg.fillStyle = 'rgba(2,3,4,.975)';
      fg.fillRect(0, 0, fc.width, fc.height);
      fg.setTransform(sf.dpr, 0, 0, sf.dpr, 0, 0);
      fg.globalCompositeOperation = 'destination-out';
      fg.globalAlpha = 0.2;
      fg.drawImage(memCv[0], 0, 0, sf.w, sf.h);
      fg.globalAlpha = 1;
      const px = X(S.x), py = Y(S.y);
      const esc = S.state === 'escape' || S.state === 'over' ? clamp(S.escT / 1.1, 0, 1) : 0;
      const R = k * LIGHT * S.flick * (1 + esc * 6);
      const lg = fg.createRadialGradient(px, py, k * 0.35, px, py, R);
      lg.addColorStop(0, 'rgba(0,0,0,1)');
      lg.addColorStop(0.45, 'rgba(0,0,0,.93)');
      lg.addColorStop(0.8, 'rgba(0,0,0,.35)');
      lg.addColorStop(1, 'rgba(0,0,0,0)');
      fg.fillStyle = lg;
      fg.beginPath(); fg.arc(px, py, R, 0, Math.PI * 2); fg.fill();
      fg.globalCompositeOperation = 'source-over';
      g.drawImage(fc, 0, 0, sf.w, sf.h);

      /* the maze's outer wall, just visible in the dark */
      g.save();
      g.strokeStyle = hsl(HUE, 30, 45, 0.28);
      g.lineWidth = 2;
      g.shadowBlur = 12;
      g.shadowColor = hsl(HUE, 80, 40, 0.5);
      g.strokeRect(L.ox - 1, L.oy - 1, L.mw + 2, L.mh + 2);
      g.restore();

      /* faint wisps drifting through the walls, glimpsed in the dark */
      if (!reduced) {
        g.save();
        g.globalCompositeOperation = 'lighter';
        for (const w of S.wisps) {
          const a = 0.07 + 0.05 * Math.sin(S.time * 1.3 + w.ph);
          const gx = X(w.x), gy = Y(w.y);
          const grd = g.createRadialGradient(gx, gy, 0, gx, gy, k * 0.8);
          grd.addColorStop(0, hsl(HUE + 60, 70, 75, a));
          grd.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = grd;
          g.fillRect(gx - k, gy - k, k * 2, k * 2);
        }
        g.restore();
      }

      /* warm lantern light over what it reveals */
      g.save();
      g.globalCompositeOperation = 'lighter';
      const warm = g.createRadialGradient(px, py, 0, px, py, k * LIGHT * 0.9);
      warm.addColorStop(0, `rgba(255,150,60,${0.16 * S.flick})`);
      warm.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = warm;
      g.beginPath(); g.arc(px, py, k * LIGHT, 0, Math.PI * 2); g.fill();
      /* the door's light, once you are close enough to see it */
      const dd = Math.hypot(S.x - (ex + 0.5), S.y - (ey + 0.5));
      const near = S.state === 'escape' || S.state === 'over' ? 1 : clamp((SEE + 1 - dd) / 1.5, 0, 1);
      if (near > 0) {
        const d = byName[M.side];
        const gx = X(ex + 0.5) + d.dx * k * 0.5, gy = Y(ey + 0.5) + d.dy * k * 0.5;
        const pulse = reduced ? 1 : 0.85 + Math.sin(S.time * 2.6) * 0.15;
        const dg = g.createRadialGradient(gx, gy, 0, gx, gy, k * 2.4);
        dg.addColorStop(0, hsl(HUE, 100, 60, 0.55 * near * pulse));
        dg.addColorStop(0.4, hsl(HUE, 100, 45, 0.18 * near * pulse));
        dg.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = dg;
        g.fillRect(gx - k * 2.5, gy - k * 2.5, k * 5, k * 5);
      }
      g.restore();

      /* you */
      if (S.state !== 'over') {
        const a = S.state === 'escape' ? clamp(1 - (S.escT - 0.4) / 0.5, 0, 1) : 1;
        g.save();
        g.globalAlpha = a;
        const bob = reduced || !S.dir ? 0 : Math.sin(S.time * 18) * k * 0.03;
        pumpkin(g, px, py + bob, k * 0.3, S.face);
        g.restore();
      }
      if (esc > 0) {
        g.fillStyle = hsl(HUE, 100, 75, esc * 0.35);
        g.fillRect(0, 0, sf.w, sf.h);
      }

      hud(g);
      if (S.state === 'ready') {
        prompt(g, sf,
          coarse() ? 'Find the way out — drag to walk' : 'Find the way out — arrow keys, WASD or drag',
          'Your lantern only lights what’s close. The clock starts when you move.', HUE, L.oy + L.mh * 0.32);
      }
    }

    /* ------------------------------ input ------------------------------ */
    const KEYS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' };
    const onKey = e => {
      if (!ownsKey(el, e)) return;
      const n = KEYS[e.code];
      if (!n) return;
      e.preventDefault();
      snd.wake();
      if (e.repeat) return;
      const d = byName[n];
      S.held = S.held.filter(x => x !== d);
      S.held.push(d);
      S.tap = d;
    };
    const onKeyUp = e => {
      const n = KEYS[e.code];
      if (n) S.held = S.held.filter(x => x !== byName[n]);
    };
    const onBlur = () => { S.held = []; S.joy = null; };
    let pd = null;
    const onDown = e => {
      if (e.button > 0) return;
      e.preventDefault();
      snd.wake();
      pd = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
      try { sf.cv.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
    };
    const onMove = e => {
      if (!pd || e.pointerId !== pd.id) return;
      const dx = e.clientX - pd.x, dy = e.clientY - pd.y;
      if (Math.hypot(dx, dy) < 16) { if (pd.moved) S.joy = null; return; }
      pd.moved = true;
      S.joy = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? byName.right : byName.left) : (dy > 0 ? byName.down : byName.up);
    };
    const onUp = e => {
      if (!pd || e.pointerId !== pd.id) return;
      if (!pd.moved && e.type === 'pointerup') {
        /* a tap: one step toward where you tapped, from the lantern */
        const r = sf.cv.getBoundingClientRect();
        const L = lay();
        const dx = e.clientX - r.left - (L.ox + S.x * L.c), dy = e.clientY - r.top - (L.oy + S.y * L.c);
        if (Math.hypot(dx, dy) > L.c * 0.4) S.tap = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? byName.right : byName.left) : (dy > 0 ? byName.down : byName.up);
      }
      pd = null;
      S.joy = null;
    };
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
      pause() { S.paused = true; S.held = []; S.joy = null; loop.stop(); draw(); },
      resume() { S.paused = false; if (S.state !== 'over') loop.start(); },
      /* a read-only snapshot for automated play-tests (cell units; open bits N1 E2 S4 W8) */
      peek: () => ({
        state: S.state, paused: S.paused, cols: M.cols, rows: M.rows,
        cell: { x: Math.floor(S.x), y: Math.floor(S.y) }, pos: { x: S.x, y: S.y }, moving: !!S.dir,
        start: { x: sx, y: sy }, exit: { x: ex, y: ey, side: M.side }, open: Array.from(M.open),
        steps: S.steps, seconds: Math.round(S.t * 10) / 10, shortest: M.shortest,
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
