/* ============================================================
   arcade/minigolf.js — Mini Golf for Static Arcade.

   Nine holes seen from above: walls to bounce off, slopes that push
   the ball, sand that holds it back, water that costs a stroke and
   sends it back to where you last hit from, a windmill and a sliding
   bar to time. Get the ball into the cup in as few strokes as you
   can; every hole has a par and the scorecard keeps the tally. After
   seven strokes on one hole the ball is picked up and the hole counts
   seven. Score: total strokes over the nine (fewer is better).

   Aim by dragging BACK from anywhere, like a slingshot: the longer
   the pull, the harder the putt; let go to hit (a tiny pull cancels).
   Keyboard: ← → turn the aim, hold Space (or Enter) to charge the
   putt and let go to hit. Touch is the same as the mouse. Between
   holes click, tap or press Space for the next one.

   Physics: a fixed 1/240-second step; the ball is a circle that
   collides with every wall segment (and the moving ones, using the
   wall's own speed), loses speed to the grass (a constant drag), the
   sand (a lot more), and is pushed along by slope patches.
   ============================================================ */
import { clamp, hsl, FONT, coarse, fitView, surface, ownsKey, sounder, looper, rr, prompt } from './kit.js';

const VW = 640, VH = 440, TOP = 36;             /* the course is 640 × 400, with a strip of scoreboard above it */
const R = 5.5, CUP_R = 9, DT = 1 / 240;
const MAX_SPEED = 600, DRAG_MAX = 130;
const GRASS_DRAG = 260, SAND_DRAG = 1150, STOP_SPEED = 9, REST = 0.8, MAX_STROKES = 7;

const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
/* The nine holes. area: the outline of the fairway (the ball stays inside it); walls: extra segments;
   sand / water: [x, y, w, h]; slope: pushes with (ax, ay) px/s²; mill: four arms turning at w rad/s;
   slider: a bar that moves up and down; posts: round pegs. */
const HOLES = [
  { name: 'Straight and narrow', par: 2, tee: [110, 200], cup: [530, 200], area: rect(60, 150, 520, 100) },
  { name: 'Dogleg', par: 3, tee: [100, 110], cup: [500, 320], area: [[60, 70], [560, 70], [560, 350], [440, 350], [440, 150], [60, 150]] },
  { name: 'Crosswind', par: 3, tee: [100, 200], cup: [530, 200], area: rect(60, 110, 520, 180), slope: [{ x: 240, y: 110, w: 170, h: 180, ax: 0, ay: 210 }] },
  { name: 'Sand trap', par: 3, tee: [100, 200], cup: [530, 200], area: rect(60, 110, 520, 180), sand: [[250, 110, 120, 180]] },
  { name: 'Over the pond', par: 3, tee: [100, 200], cup: [530, 190], area: rect(60, 110, 520, 180), water: [[270, 110, 100, 130]] },
  { name: 'The windmill', par: 4, tee: [100, 200], cup: [540, 200], area: rect(60, 100, 520, 200), mill: { x: 330, y: 200, len: 96, w: 1.5 } },
  { name: 'Zigzag', par: 4, tee: [100, 110], cup: [530, 295], area: rect(60, 70, 520, 260), walls: [[60, 160, 440, 160], [200, 240, 580, 240]] },
  { name: 'The gatekeeper', par: 3, tee: [100, 200], cup: [535, 200], area: rect(60, 110, 520, 180), slider: { x: 320, y: 200, w: 14, h: 84, amp: 62, per: 3.4 } },
  { name: 'Grand finale', par: 4, tee: [100, 110], cup: [540, 295], area: rect(60, 70, 520, 260), water: [[230, 140, 150, 120]], sand: [[430, 70, 150, 70], [60, 262, 120, 68]], posts: [{ x: 460, y: 220, r: 12 }], slope: [{ x: 380, y: 140, w: 100, h: 120, ax: -120, ay: 0 }] },
];
export const COURSE_PAR = HOLES.reduce((a, b) => a + b.par, 0);

const SCORE_NAME = (strokes, par) => (strokes === 1 ? 'Hole in one!' : strokes <= par - 2 ? 'Eagle' : strokes === par - 1 ? 'Birdie' : strokes === par ? 'Par' : strokes === par + 1 ? 'Bogey' : strokes === par + 2 ? 'Double bogey' : `${strokes - par} over`);
const inRect = (x, y, r) => x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3];

export default {
  mount(el, ctx) {
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    const S = {
      state: 'aim',                       /* aim | roll | sink | card | final */
      paused: false, time: 0,
      hole: 0, strokes: 0, scores: [], total: 0,
      ball: { x: 0, y: 0, vx: 0, vy: 0 }, last: { x: 0, y: 0 }, sinkT: 0,
      angle: 0, charge: 0, charging: false, chargeT: 0, drag: null, kbTurn: 0, usedKb: false,
      splashes: [], trail: [], water: 0, bounces: 0, over: false, flash: '', flashT: 0, cardT: 0,
    };
    const sf = surface(el, 'Mini Golf course', () => draw());
    let V = fitView(sf, VW, VH, 6);
    let segs = [], movers = [], posts = [];

    function load(n) {
      const H = HOLES[n];
      S.hole = n; S.strokes = 0; S.state = 'aim'; S.sinkT = 0; S.water = 0; S.trail = []; S.splashes = [];
      S.ball = { x: H.tee[0], y: H.tee[1], vx: 0, vy: 0 };
      S.last = { x: H.tee[0], y: H.tee[1] };
      S.angle = Math.atan2(H.cup[1] - H.tee[1], H.cup[0] - H.tee[0]);
      S.charging = false; S.charge = 0; S.drag = null;
      segs = [];
      const a = H.area;
      for (let i = 0; i < a.length; i++) segs.push({ ax: a[i][0], ay: a[i][1], bx: a[(i + 1) % a.length][0], by: a[(i + 1) % a.length][1], vx: 0, vy: 0, t: 4.5 });
      for (const w of H.walls || []) segs.push({ ax: w[0], ay: w[1], bx: w[2], by: w[3], vx: 0, vy: 0, t: 4.5 });
      posts = (H.posts || []).map(p => ({ ...p }));
      movers = [];
      if (H.mill) { posts.push({ x: H.mill.x, y: H.mill.y, r: 9 }); for (let k = 0; k < 4; k++) movers.push({ kind: 'arm', k, ...H.mill }); }
      if (H.slider) movers.push({ kind: 'slide', ...H.slider });
      moveMovers();
      ctx.onScore(S.total);
    }

    /* the moving parts at S.time: their segments and how fast each point moves */
    function moveMovers() {
      segs = segs.filter(s => !s.mover);
      for (const m of movers) {
        if (m.kind === 'arm') {
          const th = m.w * S.time + (m.k * Math.PI) / 2;
          const ex = m.x + Math.cos(th) * m.len, ey = m.y + Math.sin(th) * m.len;
          m.seg = { ax: m.x, ay: m.y, bx: ex, by: ey, vx: 0, vy: 0, wv: [-Math.sin(th) * m.w * m.len, Math.cos(th) * m.w * m.len], mover: true, t: 5 };
          segs.push(m.seg);
        } else {
          const cy = m.y + m.amp * Math.sin((S.time / m.per) * Math.PI * 2), vy = m.amp * ((Math.PI * 2) / m.per) * Math.cos((S.time / m.per) * Math.PI * 2);
          m.cy = cy;
          const x0 = m.x - m.w / 2, x1 = m.x + m.w / 2, y0 = cy - m.h / 2, y1 = cy + m.h / 2;
          for (const [a, b, c, d] of [[x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]]) segs.push({ ax: a, ay: b, bx: c, by: d, vx: 0, vy, mover: true });
        }
      }
    }

    /* ------------------------------ physics ------------------------------ */
    const H_ = () => HOLES[S.hole];
    const onSand = () => (H_().sand || []).some(r => inRect(S.ball.x, S.ball.y, r));
    const slopeAt = () => { for (const s of H_().slope || []) if (inRect(S.ball.x, S.ball.y, [s.x, s.y, s.w, s.h])) return s; return null; };
    const inWater = () => (H_().water || []).some(r => inRect(S.ball.x, S.ball.y, r));

    function collide() {
      const b = S.ball;
      for (const s of segs) {
        const dx = s.bx - s.ax, dy = s.by - s.ay, l2 = dx * dx + dy * dy || 1;
        const t = clamp(((b.x - s.ax) * dx + (b.y - s.ay) * dy) / l2, 0, 1);
        const px = s.ax + dx * t, py = s.ay + dy * t;
        let nx = b.x - px, ny = b.y - py, d = Math.hypot(nx, ny);
        const T = R + (s.t || 0);
        if (d >= T) continue;
        if (d < 1e-6) { const l = Math.sqrt(l2); nx = -dy / l; ny = dx / l; d = 1e-6; } else { nx /= d; ny /= d; }
        b.x = px + nx * T; b.y = py + ny * T;
        const wvx = s.wv ? s.wv[0] * t : s.vx, wvy = s.wv ? s.wv[1] * t : s.vy;
        const vn = (b.vx - wvx) * nx + (b.vy - wvy) * ny;
        if (vn < 0) {
          b.vx -= (1 + REST) * vn * nx; b.vy -= (1 + REST) * vn * ny;
          if (-vn > 60) { S.bounces++; snd.blip(220 + Math.min(300, -vn * 0.4), 0.04, 'triangle', 0.5); }
        }
      }
      for (const p of posts) {
        const nx0 = b.x - p.x, ny0 = b.y - p.y, d = Math.hypot(nx0, ny0);
        if (d >= R + p.r || d < 1e-6) continue;
        const nx = nx0 / d, ny = ny0 / d;
        b.x = p.x + nx * (R + p.r); b.y = p.y + ny * (R + p.r);
        const vn = b.vx * nx + b.vy * ny;
        if (vn < 0) { b.vx -= (1 + REST) * vn * nx; b.vy -= (1 + REST) * vn * ny; if (-vn > 60) { S.bounces++; snd.blip(320, 0.04, 'triangle', 0.5); } }
      }
    }

    function step(dt) {
      S.time += dt;
      moveMovers();
      if (S.state === 'sink') {
        S.sinkT += dt;
        if (S.sinkT > (reduced ? 0.25 : 0.7)) holeDone(false);
        return;
      }
      if (S.state !== 'roll') return;
      const b = S.ball, Hh = H_();
      const sl = slopeAt();
      if (sl) { b.vx += sl.ax * dt; b.vy += sl.ay * dt; }
      const drag = onSand() ? SAND_DRAG : GRASS_DRAG;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > 0) { const d = Math.min(sp, drag * dt); b.vx -= (b.vx / sp) * d; b.vy -= (b.vy / sp) * d; }
      b.x += b.vx * dt; b.y += b.vy * dt;
      collide();
      /* the cup: a ball that is slow enough drops in; a fast one skips over it */
      const dc = Math.hypot(b.x - Hh.cup[0], b.y - Hh.cup[1]), sp2 = Math.hypot(b.vx, b.vy);
      if ((dc < 7.5 && sp2 < 360) || (dc < CUP_R + 2 && sp2 < 90)) {
        b.x = Hh.cup[0]; b.y = Hh.cup[1]; b.vx = b.vy = 0;
        S.state = 'sink'; S.sinkT = 0;
        snd.blip(520, 0.12, 'triangle', 1, 880); snd.blip(780, 0.2, 'sine', 0.8, 1040);
        return;
      }
      if (inWater()) { splash(b.x, b.y); S.water++; S.strokes++; b.x = S.last.x; b.y = S.last.y; b.vx = b.vy = 0; S.state = 'aim'; S.flash = 'Splash! +1 stroke'; S.flashT = S.time; snd.blip(240, 0.25, 'sine', 0.9, 90); settle(); return; }
      /* a stray ball (should never happen): back to where it was hit from */
      if (b.x < -30 || b.x > VW + 30 || b.y < -30 || b.y > VH + 30) { b.x = S.last.x; b.y = S.last.y; b.vx = b.vy = 0; S.state = 'aim'; S.strokes++; S.flash = 'Out of bounds! +1 stroke'; S.flashT = S.time; settle(); return; }
      if (S.trail.length === 0 || Math.hypot(b.x - S.trail[S.trail.length - 1].x, b.y - S.trail[S.trail.length - 1].y) > 6) { S.trail.push({ x: b.x, y: b.y }); if (S.trail.length > 22) S.trail.shift(); }
      const slopeMag = sl ? Math.hypot(sl.ax, sl.ay) : 0;
      if (sp2 < STOP_SPEED && slopeMag < drag) { b.vx = b.vy = 0; S.state = 'aim'; settle(); }
    }
    function settle() {
      if (S.strokes >= MAX_STROKES && S.state === 'aim') { S.flash = 'Pick up: seven strokes'; S.flashT = S.time; holeDone(true); return; }
      /* point the aim at the cup again if the keyboard is the one aiming */
      const Hh = H_();
      if (!S.drag) S.angle = Math.atan2(Hh.cup[1] - S.ball.y, Hh.cup[0] - S.ball.x);
    }
    function splash(x, y) { if (!reduced) for (let i = 0; i < 10; i++) { const a = Math.random() * 6.28, v = 40 + Math.random() * 70; S.splashes.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 }); } }

    function putt(angle, power) {
      if (S.state !== 'aim' || S.paused) return false;
      power = clamp(power, 0, 1);
      if (power < 0.03) return false;
      const sp = power * MAX_SPEED;
      S.last = { x: S.ball.x, y: S.ball.y };
      S.ball.vx = Math.cos(angle) * sp; S.ball.vy = Math.sin(angle) * sp;
      S.strokes++; S.state = 'roll'; S.trail = [];
      snd.blip(180 + power * 200, 0.07, 'square', 0.7);
      return true;
    }

    function holeDone(pickedUp) {
      const par = H_().par, strokes = pickedUp ? MAX_STROKES : S.strokes;
      S.scores[S.hole] = { strokes, par, water: S.water, name: SCORE_NAME(strokes, par) };
      S.total = S.scores.reduce((a, s) => a + (s ? s.strokes : 0), 0);
      ctx.onScore(S.total);
      S.state = S.hole === HOLES.length - 1 ? 'final' : 'card';
      S.cardT = S.time;
      S.ball.vx = S.ball.vy = 0;
      if (S.state === 'final') {
        const diff = S.total - COURSE_PAR;
        setTimeout(() => {
          if (S.over || dead) return;
          S.over = true;
          ctx.onEnd({ score: S.total, detail: `Nine holes in ${S.total} strokes (par ${COURSE_PAR}, ${diff === 0 ? 'level' : diff > 0 ? diff + ' over' : -diff + ' under'}). ${S.scores.filter(s => s.strokes === 1).length ? 'With a hole in one!' : ''}`.trim() });
        }, reduced ? 400 : 1800);
      }
    }
    function nextHole() {
      if (S.state !== 'card') return;
      load(S.hole + 1);
    }
    let dead = false;

    const loop = looper(dt => {
      if (S.paused) return;
      /* keyboard aim and charge */
      if (S.state === 'aim') {
        if (S.kbTurn) { S.angle += S.kbTurn * 1.9 * dt; S.usedKb = true; }
        if (S.charging) { S.chargeT += dt; const ph = (S.chargeT / 1.5) % 2; S.charge = ph < 1 ? ph : 2 - ph; }
      }
      for (let acc = dt; acc > 1e-9;) { const d = Math.min(DT, acc); step(d); acc -= d; }
      for (const p of S.splashes) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
      S.splashes = S.splashes.filter(p => p.life > 0);
      draw();
    });

    /* ------------------------------ drawing ------------------------------ */
    function poly(g, pts) { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); }
    function drawCourse(g) {
      const Hh = H_();
      /* the rough around the fairway */
      g.fillStyle = '#133318'; g.fillRect(0, 0, VW, VH - TOP);
      g.fillStyle = 'rgba(255,255,255,.025)';
      for (let i = 0; i < 40; i++) g.fillRect((i * 97) % VW, (i * 53) % 400, 3, 2);
      /* the fairway, striped */
      g.save();
      poly(g, Hh.area); g.clip();
      g.fillStyle = '#2e8b3e'; g.fillRect(0, 0, VW, VH);
      for (let x = 0; x < VW; x += 40) { g.fillStyle = (x / 40) % 2 ? 'rgba(255,255,255,.045)' : 'rgba(0,0,0,.05)'; g.fillRect(x, 0, 40, VH); }
      for (const s of Hh.slope || []) {
        g.fillStyle = 'rgba(0,0,0,.10)'; g.fillRect(s.x, s.y, s.w, s.h);
        g.strokeStyle = 'rgba(210,255,200,.5)'; g.lineWidth = 2; g.lineCap = 'round'; g.lineJoin = 'round';
        const ang = Math.atan2(s.ay, s.ax), ux = Math.cos(ang), uy = Math.sin(ang);
        const off = reduced ? 0 : (S.time * 28) % 40;
        for (let yy = s.y + 16; yy < s.y + s.h; yy += 40) for (let xx = s.x + 16; xx < s.x + s.w; xx += 40) {
          const cx = xx + ux * off * 0.4, cy = yy + uy * off * 0.4;
          g.beginPath(); g.moveTo(cx - ux * 8 - uy * 6, cy - uy * 8 + ux * 6); g.lineTo(cx + ux * 5, cy + uy * 5); g.lineTo(cx - ux * 8 + uy * 6, cy - uy * 8 - ux * 6); g.stroke();
        }
      }
      for (const [x, y, w, h] of Hh.sand || []) {
        g.fillStyle = '#d8c079'; g.fillRect(x, y, w, h);
        g.fillStyle = 'rgba(120,90,30,.35)';
        for (let i = 0; i < w * h / 160; i++) g.fillRect(x + ((i * 37) % w), y + ((i * 59) % h), 1.6, 1.6);
      }
      for (const [x, y, w, h] of Hh.water || []) {
        const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, '#2b7fd1'); gr.addColorStop(1, '#16508f');
        g.fillStyle = gr; g.fillRect(x, y, w, h);
        g.strokeStyle = 'rgba(200,230,255,.45)'; g.lineWidth = 1.4;
        for (let i = 0; i < 7; i++) {
          const wx = x + ((i * 41 + (reduced ? 0 : S.time * 14)) % (w - 16)) + 4, wy = y + 12 + ((i * 29) % (h - 20));
          g.beginPath(); g.moveTo(wx, wy); g.quadraticCurveTo(wx + 5, wy - 4, wx + 10, wy); g.stroke();
        }
      }
      g.restore();
      /* the tee and the cup */
      g.fillStyle = 'rgba(255,255,255,.25)'; g.beginPath(); g.arc(Hh.tee[0], Hh.tee[1], 9, 0, 7); g.fill();
      const [cx, cy] = Hh.cup;
      g.fillStyle = '#05080a'; g.beginPath(); g.arc(cx, cy, CUP_R, 0, 7); g.fill();
      g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1.5; g.stroke();
      /* the walls */
      g.lineCap = 'round'; g.lineJoin = 'round';
      const wall = (ax, ay, bx, by) => {
        g.strokeStyle = '#4a2c12'; g.lineWidth = 9; g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
        g.strokeStyle = '#a8703a'; g.lineWidth = 5.5; g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
      };
      for (const s of segs) if (!s.mover) wall(s.ax, s.ay, s.bx, s.by);
      for (const p of posts) { g.fillStyle = '#4a2c12'; g.beginPath(); g.arc(p.x, p.y, p.r + 2, 0, 7); g.fill(); g.fillStyle = '#c9893f'; g.beginPath(); g.arc(p.x, p.y, p.r - 1, 0, 7); g.fill(); }
      for (const m of movers) {
        if (m.kind === 'arm') {
          const s = m.seg;
          g.strokeStyle = '#7d1f1f'; g.lineWidth = 12.5; g.beginPath(); g.moveTo(s.ax, s.ay); g.lineTo(s.bx, s.by); g.stroke();
          g.strokeStyle = m.k % 2 ? '#fff4e0' : '#e23d3d'; g.lineWidth = 8.5; g.beginPath(); g.moveTo(s.ax, s.ay); g.lineTo(s.bx, s.by); g.stroke();
        } else {
          g.fillStyle = '#4a2c12'; rr(g, m.x - m.w / 2 - 2, m.cy - m.h / 2 - 2, m.w + 4, m.h + 4, 5); g.fill();
          g.fillStyle = '#e8b84a'; rr(g, m.x - m.w / 2, m.cy - m.h / 2, m.w, m.h, 4); g.fill();
          g.fillStyle = 'rgba(0,0,0,.25)'; for (let y = m.cy - m.h / 2 + 8; y < m.cy + m.h / 2 - 4; y += 14) g.fillRect(m.x - m.w / 2 + 2, y, m.w - 4, 5);
        }
      }
      /* the flag */
      if (S.state !== 'sink') {
        g.strokeStyle = '#f1f1f1'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx, cy - 34); g.stroke();
        g.fillStyle = '#ff4d5e'; g.beginPath(); g.moveTo(cx, cy - 34); g.lineTo(cx + 18, cy - 28 + (reduced ? 0 : Math.sin(S.time * 4) * 1.5)); g.lineTo(cx, cy - 22); g.closePath(); g.fill();
      }
      /* the ball's trail, the splash, the ball */
      S.trail.forEach((t, i) => { g.fillStyle = `rgba(255,255,255,${(i / S.trail.length) * 0.22})`; g.beginPath(); g.arc(t.x, t.y, R * 0.7, 0, 7); g.fill(); });
      for (const p of S.splashes) { g.fillStyle = `rgba(190,225,255,${p.life * 2})`; g.beginPath(); g.arc(p.x, p.y, 2.4, 0, 7); g.fill(); }
      const b = S.ball, k = S.state === 'sink' ? Math.max(0, 1 - S.sinkT / (reduced ? 0.25 : 0.7)) : 1;
      g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(b.x + 1.5, b.y + 2.5, R * k, R * 0.7 * k, 0, 0, 7); g.fill();
      const gr = g.createRadialGradient(b.x - 1.8, b.y - 2, 0.5, b.x, b.y, R);
      gr.addColorStop(0, '#fff'); gr.addColorStop(1, '#bfc9d4');
      g.fillStyle = gr; g.beginPath(); g.arc(b.x, b.y, R * k, 0, 7); g.fill();
      /* the aim */
      if (S.state === 'aim' && !S.paused) {
        let ang = S.angle, pw = 0;
        if (S.drag) { const dx = S.drag.x - b.x, dy = S.drag.y - b.y; pw = clamp(Math.hypot(dx, dy) / DRAG_MAX, 0, 1); if (pw > 0.03) ang = Math.atan2(-dy, -dx); }
        else if (S.charging) pw = S.charge;
        const show = S.drag || S.charging || S.usedKb;
        const len = 26 + (S.drag || S.charging ? pw * 90 : 40);
        if (show) {
          g.setLineDash([5, 5]); g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 2;
          g.beginPath(); g.moveTo(b.x + Math.cos(ang) * 9, b.y + Math.sin(ang) * 9); g.lineTo(b.x + Math.cos(ang) * len, b.y + Math.sin(ang) * len); g.stroke(); g.setLineDash([]);
          g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); const ex = b.x + Math.cos(ang) * len, ey = b.y + Math.sin(ang) * len;
          g.moveTo(ex + Math.cos(ang) * 7, ey + Math.sin(ang) * 7); g.lineTo(ex + Math.cos(ang + 2.4) * 7, ey + Math.sin(ang + 2.4) * 7); g.lineTo(ex + Math.cos(ang - 2.4) * 7, ey + Math.sin(ang - 2.4) * 7); g.fill();
        }
        if (S.drag || S.charging) {
          /* the power meter beside the ball */
          const mx = clamp(b.x + 18, 20, VW - 40), my = clamp(b.y - 40, 8, 400 - 56);
          g.fillStyle = 'rgba(0,0,0,.55)'; rr(g, mx, my, 10, 48, 4); g.fill();
          g.fillStyle = hsl(120 - pw * 120, 90, 55); rr(g, mx + 1.5, my + 46.5 - 45 * pw, 7, Math.max(2, 45 * pw), 3); g.fill();
        }
      }
    }
    function drawCard(g) {
      const w = Math.min(VW - 40, 560), x = (VW - w) / 2, y = 70, hh = 250;
      g.fillStyle = 'rgba(4,10,6,.9)'; rr(g, x, y, w, hh, 14); g.fill();
      g.strokeStyle = 'rgba(120,230,150,.5)'; g.lineWidth = 1.5; rr(g, x, y, w, hh, 14); g.stroke();
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#f2fff3';
      const fin = S.state === 'final', sc = S.scores[S.hole];
      g.font = `700 22px ${FONT}`; g.fillText(fin ? 'Round complete' : `Hole ${S.hole + 1}: ${sc.name}`, VW / 2, y + 30);
      g.font = `500 14px ${FONT}`; g.fillStyle = hsl(120, 50, 78);
      g.fillText(fin ? `${S.total} strokes, par ${COURSE_PAR}` : `${HOLES[S.hole].name} · ${sc.strokes} stroke${sc.strokes === 1 ? '' : 's'} on a par ${sc.par}${sc.water ? ` · ${sc.water} in the water` : ''}`, VW / 2, y + 56);
      /* the scorecard: nine columns */
      const cw = (w - 100) / 9, tx = x + 80, ty = y + 92;
      g.font = `600 12px ${FONT}`; g.textAlign = 'right'; g.fillStyle = hsl(120, 30, 65);
      g.fillText('Hole', tx - 10, ty); g.fillText('Par', tx - 10, ty + 30); g.fillText('You', tx - 10, ty + 60); g.fillText('+/−', tx - 10, ty + 90);
      g.textAlign = 'center';
      let run = 0, parRun = 0;
      HOLES.forEach((Hl, i) => {
        const cx = tx + cw * (i + 0.5), s = S.scores[i];
        g.fillStyle = i === S.hole ? '#ffe28a' : hsl(120, 30, 78); g.fillText(String(i + 1), cx, ty);
        g.fillStyle = hsl(120, 25, 68); g.fillText(String(Hl.par), cx, ty + 30);
        if (s) {
          run += s.strokes; parRun += s.par;
          g.fillStyle = s.strokes < s.par ? '#7dffa0' : s.strokes > s.par ? '#ff9a8a' : '#ffffff'; g.font = `700 14px ${FONT}`; g.fillText(String(s.strokes), cx, ty + 60);
          g.font = `600 12px ${FONT}`; g.fillStyle = run - parRun < 0 ? '#7dffa0' : run - parRun > 0 ? '#ff9a8a' : '#ffffff'; g.fillText(run - parRun === 0 ? 'E' : (run - parRun > 0 ? '+' : '−') + Math.abs(run - parRun), cx, ty + 90);
        }
      });
      g.fillStyle = 'rgba(255,255,255,.75)'; g.font = `500 13px ${FONT}`;
      g.fillText(fin ? 'Saving your score…' : (coarse() ? `Tap for hole ${S.hole + 2}` : `Press Space or click for hole ${S.hole + 2}`), VW / 2, y + hh - 26);
    }
    function draw() {
      if (dead) return;
      const g = sf.g;
      sf.begin();
      V = fitView(sf, VW, VH, 6);
      g.fillStyle = '#061008'; g.fillRect(0, 0, sf.w, sf.h);
      g.save();
      g.translate(V.ox, V.oy); g.scale(V.s, V.s);
      g.beginPath(); g.rect(0, 0, VW, VH); g.clip();
      /* the scoreboard strip */
      g.fillStyle = '#0a1a0e'; g.fillRect(0, 0, VW, TOP);
      g.textBaseline = 'middle'; g.font = `700 14px ${FONT}`; g.textAlign = 'left'; g.fillStyle = '#e8ffe9';
      const Hh = H_();
      g.fillText(`HOLE ${S.hole + 1}/9`, 14, TOP / 2 + 1);
      g.font = `500 13px ${FONT}`; g.fillStyle = hsl(120, 40, 72); g.fillText(Hh.name, 108, TOP / 2 + 1);
      g.textAlign = 'right'; g.font = `600 13px ${FONT}`; g.fillStyle = '#e8ffe9';
      g.fillText(`PAR ${Hh.par}   STROKES ${S.strokes}   TOTAL ${S.total + (S.state === 'card' || S.state === 'final' ? 0 : 0)}`, VW - 14, TOP / 2 + 1);
      g.save(); g.translate(0, TOP);
      g.beginPath(); g.rect(0, 0, VW, VH - TOP); g.clip();
      drawCourse(g);
      if (S.flash && S.time - S.flashT < 1.6) { g.textAlign = 'center'; g.font = `700 18px ${FONT}`; g.fillStyle = `rgba(255,235,160,${clamp(1.6 - (S.time - S.flashT), 0, 1)})`; g.fillText(S.flash, VW / 2, 24); }
      if (S.state === 'card' || S.state === 'final') drawCard(g);
      g.restore();
      g.restore();
      if (S.state === 'aim' && S.strokes === 0 && S.hole === 0 && !S.drag && !S.charging && !S.usedKb && S.time < 30) prompt(g, sf, coarse() ? 'Drag back from the ball, let go to putt' : 'Drag back to aim, let go to putt', coarse() ? 'The longer the pull, the harder the putt' : 'Or ← → to aim and hold Space to charge', 130, sf.h * 0.88);
      if (S.paused) prompt(g, sf, 'Paused', null, 130);
    }

    /* ------------------------------ input ------------------------------ */
    const toCourse = e => {
      const r = sf.cv.getBoundingClientRect();
      return { x: (e.clientX - r.left - V.ox) / V.s, y: (e.clientY - r.top - V.oy) / V.s - TOP };
    };
    const onDown = e => {
      if (e.button > 0 || S.paused) return;
      snd.wake();
      if (S.state === 'card') { nextHole(); return; }
      if (S.state !== 'aim') return;
      const p = toCourse(e);
      S.drag = { x: p.x, y: p.y, id: e.pointerId };
      try { sf.cv.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
      if (!loop.on) draw();
    };
    const onMove = e => {
      if (!S.drag || e.pointerId !== S.drag.id) return;
      const p = toCourse(e);
      S.drag.x = p.x; S.drag.y = p.y;
      if (!loop.on) draw();
    };
    const onUp = e => {
      const D = S.drag;
      if (!D || e.pointerId !== D.id) return;
      S.drag = null;
      if (e.type === 'pointercancel') return;
      const p = toCourse(e), dx = p.x - S.ball.x, dy = p.y - S.ball.y;
      putt(Math.atan2(-dy, -dx), Math.hypot(dx, dy) / DRAG_MAX);
    };
    const onKey = e => {
      if (!ownsKey(el, e) || dead) return;
      const k = e.key;
      if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'a' || k === 'd') {
        e.preventDefault(); snd.wake();
        if (S.paused) return;
        S.kbTurn = k === 'ArrowLeft' || k === 'a' ? -1 : 1;
        return;
      }
      if (k === ' ' || k === 'Enter') {
        e.preventDefault(); snd.wake();
        if (S.paused || e.repeat) return;
        if (S.state === 'card') { nextHole(); return; }
        if (S.state === 'aim' && !S.charging) { S.charging = true; S.chargeT = 0; S.charge = 0; S.usedKb = true; }
      }
    };
    const onKeyUp = e => {
      const k = e.key;
      if ((k === 'ArrowLeft' || k === 'a') && S.kbTurn < 0) S.kbTurn = 0;
      if ((k === 'ArrowRight' || k === 'd') && S.kbTurn > 0) S.kbTurn = 0;
      if ((k === ' ' || k === 'Enter') && S.charging) {
        S.charging = false;
        if (!S.paused) putt(S.angle, Math.max(0.05, S.charge));
        S.charge = 0;
      }
    };
    const onBlur = () => { S.kbTurn = 0; S.charging = false; S.drag = null; };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    sf.cv.addEventListener('pointerdown', onDown);
    sf.cv.addEventListener('pointermove', onMove);
    sf.cv.addEventListener('pointerup', onUp);
    sf.cv.addEventListener('pointercancel', onUp);

    load(0);
    draw();
    loop.start();

    return {
      stop() {
        dead = true;
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
      pause() { S.paused = true; S.charging = false; S.drag = null; S.kbTurn = 0; loop.stop(); draw(); },
      resume() { S.paused = false; if (!S.over) loop.start(); },
      peek: () => ({
        state: S.state, paused: S.paused, time: S.time, hole: S.hole + 1, par: H_().par, name: H_().name, strokes: S.strokes, total: S.total,
        scores: S.scores.map(s => (s ? { strokes: s.strokes, par: s.par, name: s.name } : null)), water: S.water, bounces: S.bounces,
        ball: { x: S.ball.x, y: S.ball.y, vx: S.ball.vx, vy: S.ball.vy }, speed: Math.hypot(S.ball.vx, S.ball.vy), tee: H_().tee.slice(), cup: H_().cup.slice(), angle: S.angle,
        sand: onSand(), maxSpeed: MAX_SPEED, holes: HOLES.length, coursePar: COURSE_PAR, over: S.over,
        view: { ox: V.ox, oy: V.oy, s: V.s, top: TOP }, drag: !!S.drag, charging: S.charging,
      }),
      /* test hook — nothing in the game calls it:
         putt({ angle, power 0..1 }) · step(seconds) · goto(hole 1..9) · place({ x, y }) · time(seconds) · next() */
      hook(cmd, arg) {
        if (cmd === 'putt') return putt(arg.angle, arg.power);
        if (cmd === 'step') { for (let t = 0; t < arg; t += DT) step(DT); }
        else if (cmd === 'goto') { S.scores.length = Math.max(0, Math.min(S.scores.length, arg - 1)); load(clamp(arg - 1, 0, HOLES.length - 1)); }
        else if (cmd === 'place') { S.ball.x = arg.x; S.ball.y = arg.y; S.ball.vx = S.ball.vy = 0; S.last = { x: arg.x, y: arg.y }; }
        else if (cmd === 'next') nextHole();
        else if (cmd === 'time') S.time = +arg || 0;
        else return false;
        draw();
        return true;
      },
    };
  },
};
