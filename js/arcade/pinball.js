/* ============================================================
   arcade/pinball.js — Pinball for Static Arcade.

   One table, three balls. Pull the plunger back and let go to send
   the ball up the right-hand lane and round the top. Two flippers
   keep it alive; three round bumpers and two slingshots kick it
   about; three lane targets across the top light up when hit, and
   lighting all three pays a bonus and raises the multiplier (up to
   x5) for the rest of the game. Shove the table with N / ↑ if the
   ball gets stuck — but shove it more than three times in a few
   seconds and the table TILTS: the flippers go dead until the ball
   is lost. Score: points (more is better).

   Keys: Z / ← left flipper, X / → right flipper (also A / D, Shift,
   /), Space / ↓ hold to pull the plunger back and release to launch,
   N / ↑ nudge. Touch: touch the left half of the screen for the left
   flipper, the right half for the right flipper; touch and hold
   anywhere while the ball waits in the lane to pull the plunger.

   Physics: a fixed 1/240-second step. The ball is a circle (radius 8)
   against line segments, round bumpers and the two flippers, which are
   capsules whose own speed is added to the bounce — so a flipper that
   swings up into a ball really hits it. At the most the ball moves
   5.8 px per step, less than its radius, so it can never tunnel through
   a wall.
   ============================================================ */
import { clamp, hsl, FONT, coarse, fitView, surface, ownsKey, sounder, looper, rr, prompt, rng } from './kit.js';

const TW = 400, TH = 700, TOP = 40, VH = TH + TOP;
const R = 8, DT = 1 / 240, G = 900, MAX_V = 1400;
const BALLS = 3, DRAIN_Y = 740;      /* below y 660 the ball is lost; DRAIN_Y is how far out of sight it may drift */
const LANE_X = 365, LANE_REST = 682;
const FL = 62, FL_REST = 0.5, FL_UP = -0.45, W_UP = 16, W_DOWN = 9;
const NUDGE_LIMIT = 3, NUDGE_WINDOW = 4;

/* the top of the table: a half-circle of 180 around (200, 200) */
const ARC = Array.from({ length: 25 }, (_, i) => { const a = Math.PI + (i / 24) * Math.PI; return [200 + 180 * Math.cos(a), 200 + 180 * Math.sin(a)]; });
const WALLS = [];
const chain = (pts, t = 3) => { for (let i = 0; i + 1 < pts.length; i++) WALLS.push({ ax: pts[i][0], ay: pts[i][1], bx: pts[i + 1][0], by: pts[i + 1][1], t }); };
chain([[20, 520], [20, 200], ...ARC.slice(1, -1), [380, 200], [380, 698]]);            /* left wall, the arch, the lane's outer wall */
chain([[350, 232], [350, 698]]);                                                     /* the lane's divider */
chain([[350, 698], [380, 698]]);                                                     /* the lane's floor */
chain([[20, 520], [108, 598]]);                                                      /* inlane guides */
chain([[350, 520], [262, 598]]);
const SLINGS = [
  { ax: 22, ay: 452, bx: 88, by: 522, t: 3, kick: 520, flash: 0 },
  { ax: 334, ay: 452, bx: 282, by: 522, t: 3, kick: 520, flash: 0 },
];
const BUMPERS = [{ x: 125, y: 270, r: 22 }, { x: 240, y: 270, r: 22 }, { x: 182, y: 355, r: 22 }];
const TARGETS = [{ x: 95, y: 150, r: 10 }, { x: 182, y: 112, r: 10 }, { x: 270, y: 150, r: 10 }];
const PIVOT = { left: { x: 112, y: 608, sx: 1 }, right: { x: 258, y: 608, sx: -1 } };

export default {
  mount(el, ctx) {
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    let rand = rng(0x51ba11);
    let dead = false;
    const S = {
      state: 'serve',                    /* serve | play | drain | over */
      paused: false, frozen: false, fuzz: false, time: 0,
      score: 0, mult: 1, ballNo: 1, balls: BALLS,
      ball: { x: LANE_X, y: LANE_REST, vx: 0, vy: 0 },
      fl: { left: { a: FL_REST, up: false, w: 0 }, right: { a: FL_REST, up: false, w: 0 } },
      keyL: false, keyR: false, ptrL: new Set(), ptrR: new Set(), plunger: false, pull: 0, pullT: 0, ptrPlunge: null,
      targets: [false, false, false], bumpFlash: BUMPERS.map(() => 0), targetFlash: TARGETS.map(() => 0),
      nudges: [], tilt: false, tiltT: 0, shake: 0, drainT: 0, stuckT: 0, msg: '', msgT: -9, parts: [], over: false,
      hits: { bumper: 0, sling: 0, target: 0, wall: 0 }, tot: { bumper: 0, sling: 0, target: 0, drains: 0 }, drains: 0, launches: 0, bonuses: 0, flips: 0, escapes: 0, maxSpeed: 0,
    };
    const sf = surface(el, 'Pinball table', () => draw());
    let V = fitView(sf, TW, VH, 4);

    const flipperPts = side => {
      const P = PIVOT[side], f = S.fl[side];
      return { px: P.x, py: P.y, qx: P.x + P.sx * FL * Math.cos(f.a), qy: P.y + FL * Math.sin(f.a), sx: P.sx };
    };

    function newGame() {
      clearTimeout(overT);
      Object.assign(S, { state: 'serve', score: 0, mult: 1, ballNo: 1, balls: BALLS, targets: [false, false, false], tilt: false, nudges: [], drainT: 0, over: false, parts: [] });
      S.hits = { bumper: 0, sling: 0, target: 0, wall: 0 }; S.drains = 0; S.launches = 0; S.bonuses = 0;
      S.fl.left = { a: FL_REST, up: false, w: 0 }; S.fl.right = { a: FL_REST, up: false, w: 0 };
      serveBall();
      ctx.onScore(0);
    }
    function serveBall() {
      S.ball = { x: LANE_X, y: LANE_REST, vx: 0, vy: 0 };
      S.state = 'serve'; S.tilt = false; S.nudges = []; S.pull = 0; S.stuckT = 0;
    }
    const inLane = () => S.ball.x > 352 && S.ball.y > 560;
    function say(t) { S.msg = t; S.msgT = S.time; }
    function add(points, x, y) {
      const n = points * S.mult;
      S.score += n;
      ctx.onScore(S.score);
      if (!reduced && x !== undefined) S.parts.push({ x, y, t: 0, text: '+' + n });
    }

    function launch(power) {
      if (S.state !== 'serve' && !(S.state === 'play' && inLane())) return false;
      S.ball.vy = -(650 + 650 * clamp(power, 0, 1)); S.ball.vx = 0;
      S.state = 'play'; S.launches++;
      snd.blip(150, 0.22, 'sawtooth', 0.8, 420);
      return true;
    }

    /* ------------------------------ physics ------------------------------ */
    function bounce(b, nx, ny, vpx, vpy, e) {
      const vn = (b.vx - vpx) * nx + (b.vy - vpy) * ny;
      if (vn < 0) { b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny; }
      return vn;
    }
    function hitSegment(b, s, e, kick) {
      const dx = s.bx - s.ax, dy = s.by - s.ay, l2 = dx * dx + dy * dy || 1;
      const t = clamp(((b.x - s.ax) * dx + (b.y - s.ay) * dy) / l2, 0, 1);
      const px = s.ax + dx * t, py = s.ay + dy * t;
      let nx = b.x - px, ny = b.y - py, d = Math.hypot(nx, ny);
      const T = R + s.t;
      if (d >= T) return false;
      if (d < 1e-6) { const l = Math.sqrt(l2); nx = -dy / l; ny = dx / l; d = 1e-6; } else { nx /= d; ny /= d; }
      b.x = px + nx * T; b.y = py + ny * T;
      const vn = bounce(b, nx, ny, 0, 0, e);
      if (kick && vn < -30) { const out = b.vx * nx + b.vy * ny; if (out < kick) { b.vx += nx * (kick - out); b.vy += ny * (kick - out); } return 'kick'; }
      if (vn < -120) S.hits.wall++;
      return true;
    }
    function hitFlipper(b, side) {
      const f = S.fl[side], F = flipperPts(side);
      const dx = F.qx - F.px, dy = F.qy - F.py, l2 = dx * dx + dy * dy;
      const u = clamp(((b.x - F.px) * dx + (b.y - F.py) * dy) / l2, 0, 1);
      const cx = F.px + dx * u, cy = F.py + dy * u;
      let nx = b.x - cx, ny = b.y - cy, d = Math.hypot(nx, ny);
      const T = R + 8 - 3.2 * u;
      if (d >= T) return;
      if (d < 1e-6) { nx = 0; ny = -1; d = 1e-6; } else { nx /= d; ny /= d; }
      b.x = cx + nx * T; b.y = cy + ny * T;
      /* the flipper's own speed at that point */
      const vpx = FL * u * f.w * -F.sx * Math.sin(f.a), vpy = FL * u * f.w * Math.cos(f.a);
      const vn = bounce(b, nx, ny, vpx, vpy, 0.38);
      if (vn < -60) snd.blip(200 + Math.abs(vn) * 0.1, 0.04, 'square', 0.4);
    }

    function physics(dt) {
      const b = S.ball;
      /* flippers */
      for (const side of ['left', 'right']) {
        const f = S.fl[side], want = (side === 'left' ? S.keyL || S.ptrL.size > 0 : S.keyR || S.ptrR.size > 0) && !S.tilt && S.state !== 'over';
        if (want !== f.up) { f.up = want; if (want) { S.flips++; snd.blip(120, 0.05, 'square', 0.5); } }
        const target = f.up ? FL_UP : FL_REST, speed = f.up ? W_UP : W_DOWN;
        const da = target - f.a;
        if (Math.abs(da) < speed * dt) { f.w = da / dt * 0; f.a = target; f.w = 0; }
        else { f.w = Math.sign(da) * speed; f.a += f.w * dt; }
      }
      if (S.state !== 'serve' && S.state !== 'play') return;
      b.vy += G * dt;
      b.x += b.vx * dt; b.y += b.vy * dt;
      const sp0 = Math.hypot(b.vx, b.vy);
      if (sp0 > MAX_V) { b.vx *= MAX_V / sp0; b.vy *= MAX_V / sp0; }
      for (const w of WALLS) hitSegment(b, w, 0.5, 0);
      for (let i = 0; i < SLINGS.length; i++) if (hitSegment(b, SLINGS[i], 0.45, SLINGS[i].kick) === 'kick' && S.state === 'play') { SLINGS[i].flash = S.time; S.hits.sling++; S.tot.sling++; add(10, (SLINGS[i].ax + SLINGS[i].bx) / 2, (SLINGS[i].ay + SLINGS[i].by) / 2); snd.blip(300, 0.06, 'square', 0.6, 520); }
      BUMPERS.forEach((p, i) => {
        const nx0 = b.x - p.x, ny0 = b.y - p.y, d = Math.hypot(nx0, ny0);
        if (d >= R + p.r || d < 1e-6) return;
        const nx = nx0 / d, ny = ny0 / d;
        b.x = p.x + nx * (R + p.r); b.y = p.y + ny * (R + p.r);
        const vn = b.vx * nx + b.vy * ny;
        if (vn < 0) {
          const out = Math.max(380, -vn * 1.15);
          b.vx += nx * (out - vn); b.vy += ny * (out - vn);
          S.bumpFlash[i] = S.time; S.hits.bumper++; S.tot.bumper++; add(100, p.x, p.y - p.r);
          snd.blip(560 + i * 90, 0.08, 'triangle', 0.7, 300);
        }
      });
      TARGETS.forEach((p, i) => {
        const nx0 = b.x - p.x, ny0 = b.y - p.y, d = Math.hypot(nx0, ny0);
        if (d >= R + p.r || d < 1e-6) return;
        const nx = nx0 / d, ny = ny0 / d;
        b.x = p.x + nx * (R + p.r); b.y = p.y + ny * (R + p.r);
        const vn = bounce(b, nx, ny, 0, 0, 0.7);
        if (vn < -20 && S.state === 'play') {
          S.targetFlash[i] = S.time;
          if (!S.targets[i]) {
            S.targets[i] = true; S.hits.target++; S.tot.target++; add(500, p.x, p.y + 20);
            snd.blip(700 + i * 120, 0.1, 'sine', 0.8);
            if (S.targets.every(Boolean)) {
              S.bonuses++; S.mult = Math.min(5, S.mult + 1); add(2000, 200, 90);
              S.targets = [false, false, false]; say(`Lanes lit! Bonus 2000 · x${S.mult}`);
              snd.blip(520, 0.3, 'triangle', 1, 1040);
            }
          }
        }
      });
      hitFlipper(b, 'left'); hitFlipper(b, 'right');
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > MAX_V) { b.vx *= MAX_V / sp; b.vy *= MAX_V / sp; }
      if (sp > S.maxSpeed) S.maxSpeed = sp;
      if (S.state === 'play' && inLane() && sp < 30) S.state = 'serve';              /* it rolled back down the lane */
      /* a ball that has stopped on something in the middle of the table gets a shake loose */
      if (S.state === 'play' && sp < 14 && !inLane()) { S.stuckT += dt; if (S.stuckT > 4) { b.vy -= 380; b.vx += (rand() - 0.5) * 300; S.stuckT = 0; } } else S.stuckT = 0;
      if (b.y > 660 && b.x < 350) lose();                     /* below the flippers: gone (the lane is further right) */
    }
    function lose() {
      if (S.state !== 'play' && S.state !== 'serve') return;
      S.state = 'drain'; S.drainT = 0; S.drains++; S.tot.drains++;
      snd.blip(260, 0.4, 'sawtooth', 0.8, 60);
      say(S.tilt ? 'TILT: ball lost' : 'Ball lost');
    }
    let overT = 0;
    function step(dt) {
      S.time += dt;
      if (S.state === 'serve' || S.state === 'play') {
        if (S.state === 'serve' && S.plunger) { S.pullT += dt; S.pull = clamp(S.pullT / 1.0, 0, 1); }
        for (let acc = dt; acc > 1e-9;) { const d = Math.min(DT, acc); physics(d); acc -= d; if (S.state === 'drain') break; }
        if (S.tilt && S.time - S.tiltT > 0 && S.state === 'play') { /* flippers stay down until the ball is lost */ }
      } else if (S.state === 'drain') {
        for (const side of ['left', 'right']) { const f = S.fl[side]; f.up = false; f.a = Math.min(FL_REST, f.a + W_DOWN * dt); f.w = 0; }
        S.drainT += dt;
        if (S.drainT > (reduced || S.fuzz ? 0.3 : 1.1)) {
          if (S.ballNo >= S.balls) {
            S.state = 'over';
            if (S.fuzz) newGame();
            else if (!S.over) {
              S.over = true;
              overT = setTimeout(() => { if (!dead) ctx.onEnd({ score: S.score, detail: `${S.hits.bumper} bumper hits, ${S.hits.target} lane targets, ${S.bonuses} lane bonus${S.bonuses === 1 ? '' : 'es'}.` }); }, reduced ? 300 : 900);
            }
          } else { S.ballNo++; serveBall(); }
        }
      }
      for (const p of S.parts) p.t += dt;
      S.parts = S.parts.filter(p => p.t < 0.9);
      if (S.tilt === false && S.nudges.length) S.nudges = S.nudges.filter(t => S.time - t < NUDGE_WINDOW);
    }

    function nudge() {
      if (S.state !== 'play' || S.paused) return;
      S.nudges = S.nudges.filter(t => S.time - t < NUDGE_WINDOW);
      S.nudges.push(S.time);
      S.shake = S.time;
      S.ball.vx += (rand() < 0.5 ? -1 : 1) * (60 + rand() * 60); S.ball.vy -= 90;
      snd.blip(90, 0.1, 'sawtooth', 0.6);
      if (S.nudges.length > NUDGE_LIMIT) { S.tilt = true; S.tiltT = S.time; say('TILT!'); snd.blip(200, 0.5, 'sawtooth', 0.9, 50); }
    }

    const loop = looper(dt => {
      if (!S.paused && !S.frozen) step(dt);
      draw();
    });

    /* ------------------------------ drawing ------------------------------ */
    function draw() {
      if (dead) return;
      const g = sf.g;
      sf.begin();
      V = fitView(sf, TW, VH, 4);
      const now = S.time;
      g.fillStyle = '#05030b'; g.fillRect(0, 0, sf.w, sf.h);
      g.save();
      g.translate(V.ox, V.oy); g.scale(V.s, V.s);
      g.beginPath(); g.rect(0, 0, TW, VH); g.clip();
      /* the scoreboard */
      g.fillStyle = '#0d0818'; g.fillRect(0, 0, TW, TOP);
      g.textBaseline = 'middle'; g.textAlign = 'left'; g.font = `700 18px ${FONT}`; g.fillStyle = '#ffe9f6';
      g.fillText(String(S.score).padStart(7, '0'), 14, TOP / 2 + 1);
      g.textAlign = 'center'; g.font = `600 12px ${FONT}`; g.fillStyle = hsl(330, 60, 75);
      g.fillText(S.mult > 1 ? `x${S.mult}` : '', 200, TOP / 2 + 1);
      g.textAlign = 'right'; g.fillStyle = '#ffe9f6'; g.fillText(`BALL ${Math.min(S.ballNo, S.balls)} / ${S.balls}`, TW - 14, TOP / 2 + 1);
      g.save();
      g.translate(0, TOP);
      if (S.shake && !reduced && now - S.shake < 0.25) g.translate(Math.sin((now - S.shake) * 90) * 3, Math.cos((now - S.shake) * 70) * 2);
      /* the table */
      g.save();
      g.beginPath(); g.moveTo(20, 700); g.lineTo(20, 200);
      ARC.forEach(([x, y]) => g.lineTo(x, y)); g.lineTo(380, 200); g.lineTo(380, 700); g.closePath(); g.clip();
      const bg = g.createLinearGradient(0, 0, 0, TH); bg.addColorStop(0, '#1b0f3d'); bg.addColorStop(1, '#0a0420');
      g.fillStyle = bg; g.fillRect(0, 0, TW, TH);
      g.fillStyle = 'rgba(255,120,220,.06)';
      for (let i = 0; i < 18; i++) { g.beginPath(); g.arc(60 + ((i * 83) % 280), 80 + ((i * 131) % 560), 22 + (i % 3) * 14, 0, 7); g.fill(); }
      g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(350, 232, 30, 470);
      g.restore();
      /* walls */
      g.lineCap = 'round'; g.lineJoin = 'round';
      g.strokeStyle = '#6c47ff'; g.lineWidth = 7; g.shadowBlur = reduced ? 0 : 10; g.shadowColor = '#6c47ff';
      g.beginPath(); g.moveTo(20, 520); g.lineTo(20, 200); ARC.forEach(([x, y]) => g.lineTo(x, y)); g.lineTo(380, 200); g.lineTo(380, 698); g.stroke();
      g.beginPath(); g.moveTo(350, 232); g.lineTo(350, 698); g.stroke();
      g.strokeStyle = '#3ad6ff'; g.shadowColor = '#3ad6ff';
      g.beginPath(); g.moveTo(20, 520); g.lineTo(108, 598); g.moveTo(350, 520); g.lineTo(262, 598); g.stroke();
      g.shadowBlur = 0;
      /* slingshots */
      SLINGS.forEach((s, i) => {
        const lit = now - s.flash < 0.12;
        g.fillStyle = lit ? '#ffe28a' : '#ff5fb0';
        g.beginPath(); g.moveTo(s.ax, s.ay); g.lineTo(s.bx, s.by); g.lineTo(i ? 350 : 20, s.by); g.lineTo(i ? 350 : 20, s.ay); g.closePath(); g.globalAlpha = 0.28; g.fill(); g.globalAlpha = 1;
        g.strokeStyle = lit ? '#fff6c8' : '#ff5fb0'; g.lineWidth = 5; g.beginPath(); g.moveTo(s.ax, s.ay); g.lineTo(s.bx, s.by); g.stroke();
      });
      /* targets */
      TARGETS.forEach((p, i) => {
        const on = S.targets[i], flash = now - S.targetFlash[i] < 0.15;
        g.fillStyle = on ? '#fff2a0' : '#2a2150'; g.strokeStyle = on ? '#ffd23f' : '#6c47ff'; g.lineWidth = 3;
        g.shadowBlur = on && !reduced ? 14 : 0; g.shadowColor = '#ffd23f';
        g.beginPath(); g.arc(p.x, p.y, p.r + (flash ? 2 : 0), 0, 7); g.fill(); g.stroke(); g.shadowBlur = 0;
      });
      /* bumpers */
      BUMPERS.forEach((p, i) => {
        const flash = now - S.bumpFlash[i] < 0.12;
        g.shadowBlur = reduced ? 0 : (flash ? 26 : 12); g.shadowColor = '#ff3da8';
        const gr = g.createRadialGradient(p.x - 6, p.y - 7, 2, p.x, p.y, p.r);
        gr.addColorStop(0, flash ? '#fff' : '#ff9ad2'); gr.addColorStop(1, flash ? '#ffd23f' : '#b3146b');
        g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, p.r + (flash ? 2 : 0), 0, 7); g.fill(); g.shadowBlur = 0;
        g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 2; g.beginPath(); g.arc(p.x, p.y, p.r * 0.55, 0, 7); g.stroke();
      });
      /* flippers */
      for (const side of ['left', 'right']) {
        const F = flipperPts(side);
        g.lineCap = 'round';
        g.strokeStyle = '#c9d3ff'; g.lineWidth = 16; g.beginPath(); g.moveTo(F.px, F.py); g.lineTo(F.qx, F.qy); g.stroke();
        g.strokeStyle = '#5b6fe0'; g.lineWidth = 12; g.beginPath(); g.moveTo(F.px, F.py); g.lineTo(F.qx, F.qy); g.stroke();
        g.fillStyle = '#ffd23f'; g.beginPath(); g.arc(F.px, F.py, 4, 0, 7); g.fill();
      }
      /* the plunger */
      const pull = S.state === 'serve' ? S.pull : 0, py = 690 + pull * 8;
      g.fillStyle = '#9aa3c2'; g.fillRect(358, py - 4, 14, 8);
      g.strokeStyle = '#6a7399'; g.lineWidth = 2; g.beginPath(); g.moveTo(365, py + 4); for (let i = 0; i < 5; i++) { g.lineTo(358, py + 6 + i * 2); g.lineTo(372, py + 7 + i * 2); } g.stroke();
      if (S.state === 'serve' && S.plunger) { g.fillStyle = 'rgba(0,0,0,.5)'; rr(g, 386 - 8, 600, 8, 80, 3); g.fill(); g.fillStyle = hsl(120 - S.pull * 120, 90, 55); rr(g, 386 - 7, 679 - 78 * S.pull, 6, Math.max(2, 78 * S.pull), 2); g.fill(); }
      /* the ball */
      if (S.state !== 'over') {
        const b = S.ball;
        g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(b.x + 3, b.y + 4, R, R * 0.8, 0, 0, 7); g.fill();
        const gr = g.createRadialGradient(b.x - 3, b.y - 3, 1, b.x, b.y, R);
        gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.5, '#cfd6e6'); gr.addColorStop(1, '#6a7490');
        g.fillStyle = gr; g.beginPath(); g.arc(b.x, b.y, R, 0, 7); g.fill();
      }
      for (const p of S.parts) { g.fillStyle = `rgba(255,240,170,${1 - p.t / 0.9})`; g.font = `700 13px ${FONT}`; g.textAlign = 'center'; g.fillText(p.text, p.x, p.y - p.t * 30); }
      if (S.msg && now - S.msgT < 1.6) { g.textAlign = 'center'; g.font = `800 20px ${FONT}`; g.fillStyle = `rgba(255,235,170,${clamp(1.6 - (now - S.msgT), 0, 1)})`; g.fillText(S.msg, 185, 420); }
      g.restore();
      g.restore();
      if (S.state === 'serve' && S.ballNo === 1 && S.launches === 0 && !S.plunger) prompt(g, sf, coarse() ? 'Touch and hold, let go to launch' : 'Hold Space, let go to launch', coarse() ? 'Left and right halves work the flippers' : 'Z and X (or ← →) work the flippers', 330, sf.h * 0.5);
      if (S.paused) prompt(g, sf, 'Paused', null, 330);
    }

    /* ------------------------------ input ------------------------------ */
    const KEYS = {
      left: ['ArrowLeft', 'KeyZ', 'KeyA', 'ShiftLeft'], right: ['ArrowRight', 'KeyX', 'KeyD', 'ShiftRight', 'Slash'],
      plunge: ['Space', 'ArrowDown'], nudge: ['ArrowUp', 'KeyW', 'KeyN'],
    };
    const held = new Set();
    const onKey = e => {
      if (!ownsKey(el, e) || dead) return;
      const c = e.code;
      const L = KEYS.left.includes(c), Rr = KEYS.right.includes(c), P = KEYS.plunge.includes(c), N = KEYS.nudge.includes(c);
      if (!(L || Rr || P || N)) return;
      e.preventDefault();
      snd.wake();
      if (S.paused) return;
      held.add(c);
      if (L) S.keyL = true;
      if (Rr) S.keyR = true;
      if (P && !S.plunger) { S.plunger = true; S.pullT = 0; S.pull = 0; }
      if (N && !e.repeat) nudge();
    };
    const onKeyUp = e => {
      const c = e.code;
      held.delete(c);
      if (KEYS.left.includes(c) && !KEYS.left.some(k => held.has(k))) S.keyL = false;
      if (KEYS.right.includes(c) && !KEYS.right.some(k => held.has(k))) S.keyR = false;
      if (KEYS.plunge.includes(c) && S.plunger) releasePlunger();
    };
    function releasePlunger() {
      const power = S.pull;
      S.plunger = false; S.pull = 0; S.pullT = 0;
      if (!S.paused) launch(Math.max(0.15, power));
    }
    const onBlur = () => { held.clear(); S.keyL = S.keyR = false; S.ptrL.clear(); S.ptrR.clear(); if (S.plunger) { S.plunger = false; S.pull = 0; } };
    const onDown = e => {
      if (e.button > 0 || S.paused) return;
      snd.wake();
      try { sf.cv.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
      if (S.state === 'serve') { S.plunger = true; S.pullT = 0; S.pull = 0; S.ptrPlunge = e.pointerId; return; }
      const r = sf.cv.getBoundingClientRect();
      (e.clientX - r.left < r.width / 2 ? S.ptrL : S.ptrR).add(e.pointerId);
    };
    const onUp = e => {
      if (S.ptrPlunge === e.pointerId) { S.ptrPlunge = null; if (S.plunger) releasePlunger(); }
      S.ptrL.delete(e.pointerId); S.ptrR.delete(e.pointerId);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    sf.cv.addEventListener('pointerdown', onDown);
    sf.cv.addEventListener('pointerup', onUp);
    sf.cv.addEventListener('pointercancel', onUp);

    ctx.onScore(0);
    draw();
    loop.start();

    /* the 5,000-frame stress run: random flipping, nudging and plunging, counting any frame the ball is outside the table */
    function fuzz({ frames = 5000, seed = 1 } = {}) {
      const r = rng(seed);
      S.fuzz = true;
      newGame();
      S.tot = { bumper: 0, sling: 0, target: 0, drains: 0 };
      let escapes = 0, flipsDone = 0, maxSpeed = 0, played = 0, nan = 0, first = null;
      for (let f = 0; f < frames; f++) {
        if (r() < 0.03) { S.keyL = !S.keyL; flipsDone++; }
        if (r() < 0.03) { S.keyR = !S.keyR; flipsDone++; }
        if (r() < 0.004) nudge();
        if (S.state === 'serve') { S.plunger = false; launch(0.55 + r() * 0.45); }
        step(1 / 60);
        const b = S.ball;
        if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) nan++;
        /* out of the table: past a side wall or the top, or below the flippers without being counted as lost */
        if (S.state === 'play') {
          played++;
          if (b.x < 15 || b.x > 385 || b.y < 12 || b.y > DRAIN_Y) { escapes++; first = first || { f, x: b.x, y: b.y, vx: b.vx, vy: b.vy }; }
        }
        maxSpeed = Math.max(maxSpeed, Math.hypot(b.vx, b.vy));
      }
      S.keyL = S.keyR = false; S.fuzz = false;
      return { frames, escapes, firstEscape: first, nan, flips: flipsDone, playedFrames: played, maxSpeed, drains: S.tot.drains, bumper: S.tot.bumper, sling: S.tot.sling, target: S.tot.target };
    }

    return {
      stop() {
        dead = true;
        clearTimeout(overT);
        loop.stop();
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onBlur);
        sf.cv.removeEventListener('pointerdown', onDown);
        sf.cv.removeEventListener('pointerup', onUp);
        sf.cv.removeEventListener('pointercancel', onUp);
        snd.close();
        sf.destroy();
      },
      pause() { S.paused = true; onBlur(); loop.stop(); draw(); },
      resume() { S.paused = false; if (!S.over) loop.start(); },
      peek: () => ({
        state: S.state, paused: S.paused, frozen: S.frozen, time: S.time, score: S.score, mult: S.mult, ballNo: S.ballNo, balls: S.balls,
        ball: { ...S.ball }, targets: S.targets.slice(), tilt: S.tilt, pull: S.pull, plunger: S.plunger,
        flippers: { left: { angle: S.fl.left.a, up: S.fl.left.up }, right: { angle: S.fl.right.a, up: S.fl.right.up } },
        hits: { ...S.hits }, drains: S.drains, launches: S.launches, bonuses: S.bonuses, flips: S.flips, maxSpeed: S.maxSpeed, over: S.over,
        view: { ox: V.ox, oy: V.oy, s: V.s, top: TOP }, nudges: S.nudges.length,
      }),
      /* test hook — nothing in the game calls it:
         freeze(bool: the clock stops, step() drives) · step(seconds) · place({ x, y, vx, vy }) · plunge(power 0..1) ·
         reset() · fuzz({ frames, seed }) -> { escapes, nan, flips, drains, … } */
      hook(cmd, arg) {
        if (cmd === 'freeze') S.frozen = !!arg;
        else if (cmd === 'step') { for (let t = 0; t < arg - 1e-9; t += 1 / 60) step(Math.min(1 / 60, arg - t)); }
        else if (cmd === 'place') { S.ball = { x: arg.x, y: arg.y, vx: arg.vx || 0, vy: arg.vy || 0 }; if (S.state === 'serve') S.state = 'play'; }
        else if (cmd === 'plunge') return launch(arg);
        else if (cmd === 'reset') newGame();
        else if (cmd === 'nudge') nudge();
        else if (cmd === 'fuzz') { const out = fuzz(arg || {}); draw(); return out; }
        else return false;
        draw();
        return true;
      },
    };
  },
};
