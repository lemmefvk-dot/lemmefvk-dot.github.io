/* ============================================================
   arcade/pinball.js — Pinball for Static Arcade.

   Two tables (ctx.mode: Classic and Comet, below), three balls. Pull
   the plunger back and let go to send the ball up the right-hand lane
   and round the top. Two flippers keep it alive; round bumpers and
   two slingshots kick it about; the targets across the top light up
   when hit, and lighting them all pays a bonus and raises the
   multiplier (up to x5) for the rest of the game. Shove the table
   with N / ↑ if the ball gets stuck — three shoves in a few seconds
   are allowed (the scoreboard shows how many are left, the third one
   warns), a fourth TILTS the table: the flippers go dead until the
   ball is lost. Score: points (more is better).

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
   a wall. Below each flipper's pivot an apron wall runs to the bottom,
   so a ball that has dropped between the flippers leaves by the drain,
   never sideways out of the cabinet.
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
const PIVOT = { left: { x: 112, y: 608, sx: 1 }, right: { x: 258, y: 608, sx: -1 } };
/* the apron: a wall down from each flipper's pivot to the bottom. Without it a ball that
   had dropped between the flippers could be flicked sideways by a rising flipper tip, under
   the other flipper and out of the cabinet at a bottom corner, before it counted as lost. */
const APRON = [[PIVOT.left.x, PIVOT.left.y, 700], [PIVOT.right.x, PIVOT.right.y, 700]];
for (const [x, y0, y1] of APRON) chain([[x, y0], [x, y1]]);

/* geometry for the escape checks (the tests' corner shots and the stress run) */
const segNear = (x, y, s) => {
  const dx = s.bx - s.ax, dy = s.by - s.ay, l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (y - s.ay) * dy) / l2));
  return [s.ax + dx * t, s.ay + dy * t];
};
const segDist = (x, y, s) => { const [px, py] = segNear(x, y, s); return Math.hypot(x - px, y - py); };
/* do p→q and a→b cross, each passing right through the other? */
const crosses = (px, py, qx, qy, ax, ay, bx, by) => {
  const d1 = (bx - ax) * (py - ay) - (by - ay) * (px - ax), d2 = (bx - ax) * (qy - ay) - (by - ay) * (qx - ax);
  const d3 = (qx - px) * (ay - py) - (qy - py) * (ax - px), d4 = (qx - px) * (by - py) - (qy - py) * (bx - px);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
};
/* which side of a flipper (its pivot→tip line) a point is on, and how far along it */
const sideOf = (F, x, y) => {
  const dx = F.qx - F.px, dy = F.qy - F.py, l = Math.hypot(dx, dy) || 1;
  return { s: (dx * (y - F.py) - dy * (x - F.px)) / l, u: ((x - F.px) * dx + (y - F.py) * dy) / (l * l) };
};

/* Two tables (ctx.mode; each keeps its own best) on the same cabinet: the walls, lanes, slingshots
   and flippers are shared, the playfield differs.
   · Classic: three big bumpers, three lane targets across the top.
   · Comet: four bumpers in a diamond, four stars round the top, a bank of four drop targets on the
     right (drop all four for a bonus and, once a game, an extra ball) and a saucer on the left
     that holds the ball a moment, pays, and kicks it back out. */
const SLING_SET = [
  { ax: 22, ay: 452, bx: 88, by: 522, t: 3, kick: 520 },
  { ax: 334, ay: 452, bx: 282, by: 522, t: 3, kick: 520 },
];
const TABLES = {
  classic: {
    bumpers: [{ x: 125, y: 270, r: 22 }, { x: 240, y: 270, r: 22 }, { x: 182, y: 355, r: 22 }],
    targets: [{ x: 95, y: 150, r: 10 }, { x: 182, y: 112, r: 10 }, { x: 270, y: 150, r: 10 }],
    drops: [], saucer: null,
    look: { bg: ['#1b0f3d', '#0a0420'], wall: '#6c47ff', guide: '#3ad6ff', blob: 'rgba(255,120,220,.06)', bump: ['#ff9ad2', '#b3146b', '#ff3da8'], sling: '#ff5fb0', target: '#6c47ff' },
  },
  comet: {
    bumpers: [{ x: 120, y: 250, r: 20 }, { x: 245, y: 250, r: 20 }, { x: 182, y: 195, r: 17 }, { x: 182, y: 315, r: 17 }],
    targets: [{ x: 70, y: 190, r: 10 }, { x: 130, y: 125, r: 10 }, { x: 235, y: 125, r: 10 }, { x: 295, y: 190, r: 10 }],
    drops: [0, 1, 2, 3].map(i => ({ ax: 318, ay: 300 + i * 25, bx: 318, by: 320 + i * 25, t: 4 })),
    saucer: { x: 90, y: 372, r: 11 },
    look: { bg: ['#06323a', '#03141a'], wall: '#ff8a3d', guide: '#3dffd2', blob: 'rgba(80,255,220,.05)', bump: ['#9dfff0', '#0d8f86', '#2fe0c8'], sling: '#ffb03d', target: '#ff8a3d' },
  },
};
const DROP_BONUS = 3000, SAUCER_POINTS = 750, SAUCER_HOLD = 0.9;

export default {
  mount(el, ctx) {
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    let rand = rng(0x51ba11);
    let dead = false;
    const MODE = TABLES[ctx.mode] ? ctx.mode : 'classic', TB = TABLES[MODE], LOOK = TB.look;
    const BUMPERS = TB.bumpers, TARGETS = TB.targets, DROPS = TB.drops, SAUCER = TB.saucer;
    const SLINGS = SLING_SET.map(s => ({ ...s, flash: 0 }));
    /* seams, for the escape checks: where the end of one surface (or a flipper's pivot) comes
       closer to another than the ball is wide, the gap between them is shut */
    const SEAMS = (() => {
      const all = [...WALLS, ...SLINGS, ...DROPS], out = [];
      const caps = [...all.flatMap(w => [[w.ax, w.ay, w.t, w], [w.bx, w.by, w.t, w]]), ...Object.values(PIVOT).map(P => [P.x, P.y, 8, P])];
      for (const [x, y, t, own] of caps) for (const w of all) {
        if (w === own) continue;
        const [nx, ny] = segNear(x, y, w), d = Math.hypot(x - nx, y - ny);
        if (d > 0.5 && d - t - w.t < 2 * R) out.push({ ax: x, ay: y, bx: nx, by: ny, t: 0, seam: true, own: [own, w] });
      }
      return out;
    })();
    const S = {
      state: 'serve',                    /* serve | play | drain | over */
      paused: false, frozen: false, fuzz: false, time: 0,
      score: 0, mult: 1, ballNo: 1, balls: BALLS,
      ball: { x: LANE_X, y: LANE_REST, vx: 0, vy: 0 },
      fl: { left: { a: FL_REST, up: false, w: 0 }, right: { a: FL_REST, up: false, w: 0 } },
      keyL: false, keyR: false, ptrL: new Set(), ptrR: new Set(), plunger: false, pull: 0, pullT: 0, ptrPlunge: null,
      targets: TARGETS.map(() => false), bumpFlash: BUMPERS.map(() => 0), targetFlash: TARGETS.map(() => 0),
      drops: DROPS.map(() => true), dropT: 0, extra: false, held: 0,
      nudges: [], tilt: false, tiltT: 0, shake: 0, drainT: 0, stuckT: 0, msg: '', msgT: -9, parts: [], over: false,
      hits: { bumper: 0, sling: 0, target: 0, wall: 0, drop: 0, saucer: 0 }, tot: { bumper: 0, sling: 0, target: 0, drains: 0 }, drains: 0, launches: 0, bonuses: 0, flips: 0, escapes: 0, maxSpeed: 0,
    };
    const sf = surface(el, 'Pinball table', () => draw());
    let V = fitView(sf, TW, VH, 4);

    const flipperPts = side => {
      const P = PIVOT[side], f = S.fl[side];
      return { px: P.x, py: P.y, qx: P.x + P.sx * FL * Math.cos(f.a), qy: P.y + FL * Math.sin(f.a), sx: P.sx };
    };

    function newGame() {
      clearTimeout(overT);
      Object.assign(S, { state: 'serve', score: 0, mult: 1, ballNo: 1, balls: BALLS, targets: TARGETS.map(() => false), drops: DROPS.map(() => true), dropT: 0, extra: false, held: 0, tilt: false, nudges: [], drainT: 0, over: false, parts: [] });
      S.hits = { bumper: 0, sling: 0, target: 0, wall: 0, drop: 0, saucer: 0 }; S.drains = 0; S.launches = 0; S.bonuses = 0;
      S.fl.left = { a: FL_REST, up: false, w: 0 }; S.fl.right = { a: FL_REST, up: false, w: 0 };
      serveBall();
      ctx.onScore(0);
    }
    function serveBall() {
      S.ball = { x: LANE_X, y: LANE_REST, vx: 0, vy: 0 };
      S.state = 'serve'; S.tilt = false; S.nudges = []; S.pull = 0; S.stuckT = 0; S.held = 0;
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
    let lastVn = 0;                     /* how hard the last segment contact was (a drop target only drops on a real hit) */
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
      lastVn = vn;
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
      /* Comet's saucer: the ball sits in it a moment, then is kicked back up the table */
      if (S.held > 0) {
        S.held -= dt;
        b.x = SAUCER.x; b.y = SAUCER.y; b.vx = 0; b.vy = 0;
        if (S.held <= 0) { S.held = 0; b.vx = 230; b.vy = -560; S.saucerCool = 0.5; snd.blip(180, 0.15, 'square', 0.8, 520); }
        return;
      }
      if (S.saucerCool > 0) S.saucerCool -= dt;
      const x0 = b.x, y0 = b.y, fl0 = S.watch ? { left: flipperPts('left'), right: flipperPts('right') } : null;
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
              S.targets = TARGETS.map(() => false); say(`${MODE === 'comet' ? 'Stars' : 'Lanes'} lit! Bonus 2000 · x${S.mult}`);
              snd.blip(520, 0.3, 'triangle', 1, 1040);
            }
          }
        }
      });
      /* Comet's drop targets: a real hit knocks one down; all four pay a bonus (and, once a game, an extra ball) */
      DROPS.forEach((d, i) => {
        if (!S.drops[i] || !hitSegment(b, d, 0.4, 0) || lastVn > -60 || S.state !== 'play') return;
        S.drops[i] = false; S.hits.drop++; add(250, d.ax - 12, (d.ay + d.by) / 2);
        snd.blip(420 + i * 70, 0.07, 'square', 0.7, 260);
        if (S.drops.every(x => !x)) {
          S.bonuses++; add(DROP_BONUS, 260, 360); S.dropT = 1.5;
          if (!S.extra) { S.extra = true; S.balls++; say(`Drop targets! Extra ball · ${DROP_BONUS}`); }
          else say(`Drop targets! Bonus ${DROP_BONUS}`);
          snd.blip(520, 0.3, 'triangle', 1, 1040);
        }
      });
      if (SAUCER && S.state === 'play' && !(S.saucerCool > 0) && Math.hypot(b.x - SAUCER.x, b.y - SAUCER.y) < 9 && Math.hypot(b.vx, b.vy) < 950) {
        S.held = SAUCER_HOLD; b.x = SAUCER.x; b.y = SAUCER.y; b.vx = 0; b.vy = 0;
        S.hits.saucer++; add(SAUCER_POINTS, SAUCER.x, SAUCER.y - 16); say(`Saucer! ${SAUCER_POINTS * S.mult}`);
        snd.blip(760, 0.2, 'sine', 0.8, 380);
        return;
      }
      hitFlipper(b, 'left'); hitFlipper(b, 'right');
      if (S.watch) watchStep(x0, y0, fl0);
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
              const detail = MODE === 'comet'
                ? `${S.hits.bumper} bumper hits, ${S.hits.target} stars, ${S.hits.drop} drop targets, ${S.hits.saucer} in the saucer, ${S.bonuses} bonus${S.bonuses === 1 ? '' : 'es'}.`
                : `${S.hits.bumper} bumper hits, ${S.hits.target} lane targets, ${S.bonuses} lane bonus${S.bonuses === 1 ? '' : 'es'}.`;
              overT = setTimeout(() => { if (!dead) ctx.onEnd({ score: S.score, detail }); }, reduced ? 300 : 900);
            }
          } else { S.ballNo++; serveBall(); }
        }
      }
      for (const p of S.parts) p.t += dt;
      S.parts = S.parts.filter(p => p.t < 0.9);
      if (S.tilt === false && S.nudges.length) S.nudges = S.nudges.filter(t => S.time - t < NUDGE_WINDOW);
      /* Comet's drop targets come back up once the ball is clear of them */
      if (S.dropT > 0) {
        S.dropT -= dt;
        const b = S.ball, near = DROPS.some(d => Math.abs(b.x - d.ax) < R + 10 && b.y > d.ay - R - 6 && b.y < d.by + R + 6);
        if (S.dropT <= 0) { if (near) S.dropT = 0.2; else S.drops = DROPS.map(() => true); }
      }
    }

    /* A shove of the table, and its limit: three in a few seconds are fine, the third one warns,
       a fourth tilts the table (the flippers go dead until the ball is lost). The scoreboard shows
       how many shoves are left before a tilt; one drops off every NUDGE_WINDOW seconds. */
    function nudge() {
      if (S.state !== 'play' || S.paused) return;            /* a tilted table can still be shoved; it just stays tilted */
      S.nudges = S.nudges.filter(t => S.time - t < NUDGE_WINDOW);
      S.nudges.push(S.time);
      S.shake = S.time;
      S.held = 0;
      S.ball.vx += (rand() < 0.5 ? -1 : 1) * (60 + rand() * 60); S.ball.vy -= 90;
      snd.blip(90, 0.1, 'sawtooth', 0.6);
      if (S.nudges.length > NUDGE_LIMIT) { S.tilt = true; S.tiltT = S.time; say('TILT!'); snd.blip(200, 0.5, 'sawtooth', 0.9, 50); }
      else if (S.nudges.length === NUDGE_LIMIT) { say('Warning: one more shove tilts'); snd.blip(330, 0.18, 'square', 0.7, 300); }
    }
    const nudgesLeft = () => (S.tilt ? 0 : Math.max(0, NUDGE_LIMIT - S.nudges.filter(t => S.time - t < NUDGE_WINDOW).length));

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
      g.fillText(S.mult > 1 ? `x${S.mult}` : '', 170, TOP / 2 + 1);
      /* shoves left before a tilt: three pips, red once it has tilted */
      const left = nudgesLeft();
      g.font = `700 9px ${FONT}`; g.fillStyle = S.tilt ? '#ff5a6a' : 'rgba(255,233,246,.6)'; g.fillText(S.tilt ? 'TILT' : 'NUDGE', 222, TOP / 2 + 1);
      for (let i = 0; i < NUDGE_LIMIT; i++) { g.fillStyle = S.tilt ? '#ff5a6a' : i < left ? hsl(50, 100, 65) : 'rgba(255,255,255,.15)'; g.beginPath(); g.arc(246 + i * 9, TOP / 2 + 1, 3, 0, 7); g.fill(); }
      g.textAlign = 'right'; g.fillStyle = '#ffe9f6'; g.font = `600 12px ${FONT}`; g.fillText(`BALL ${Math.min(S.ballNo, S.balls)} / ${S.balls}`, TW - 14, TOP / 2 + 1);
      g.save();
      g.translate(0, TOP);
      if (S.shake && !reduced && now - S.shake < 0.25) g.translate(Math.sin((now - S.shake) * 90) * 3, Math.cos((now - S.shake) * 70) * 2);
      /* the table */
      g.save();
      g.beginPath(); g.moveTo(20, 700); g.lineTo(20, 200);
      ARC.forEach(([x, y]) => g.lineTo(x, y)); g.lineTo(380, 200); g.lineTo(380, 700); g.closePath(); g.clip();
      const bg = g.createLinearGradient(0, 0, 0, TH); bg.addColorStop(0, LOOK.bg[0]); bg.addColorStop(1, LOOK.bg[1]);
      g.fillStyle = bg; g.fillRect(0, 0, TW, TH);
      g.fillStyle = LOOK.blob;
      for (let i = 0; i < 18; i++) { g.beginPath(); g.arc(60 + ((i * 83) % 280), 80 + ((i * 131) % 560), 22 + (i % 3) * 14, 0, 7); g.fill(); }
      if (MODE === 'comet') {
        /* a comet streaking across the glass */
        g.strokeStyle = 'rgba(255,170,90,.12)'; g.lineWidth = 18; g.lineCap = 'round';
        g.beginPath(); g.moveTo(60, 470); g.quadraticCurveTo(170, 380, 300, 430); g.stroke();
        g.fillStyle = 'rgba(255,220,160,.18)'; g.beginPath(); g.arc(300, 430, 14, 0, 7); g.fill();
      }
      g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(350, 232, 30, 470);
      g.restore();
      /* walls */
      g.lineCap = 'round'; g.lineJoin = 'round';
      g.strokeStyle = LOOK.wall; g.lineWidth = 7; g.shadowBlur = reduced ? 0 : 10; g.shadowColor = LOOK.wall;
      g.beginPath(); g.moveTo(20, 520); g.lineTo(20, 200); ARC.forEach(([x, y]) => g.lineTo(x, y)); g.lineTo(380, 200); g.lineTo(380, 698); g.stroke();
      g.beginPath(); g.moveTo(350, 232); g.lineTo(350, 698); g.stroke();
      g.strokeStyle = LOOK.guide; g.shadowColor = LOOK.guide;
      g.beginPath(); g.moveTo(20, 520); g.lineTo(108, 598); g.moveTo(350, 520); g.lineTo(262, 598); g.stroke();
      g.shadowBlur = 0;
      g.lineWidth = 5; g.globalAlpha = 0.55;
      g.beginPath(); for (const [x, y0, y1] of APRON) { g.moveTo(x, y0); g.lineTo(x, y1); } g.stroke();
      g.globalAlpha = 1;
      /* slingshots */
      SLINGS.forEach((s, i) => {
        const lit = now - s.flash < 0.12;
        g.fillStyle = lit ? '#ffe28a' : LOOK.sling;
        g.beginPath(); g.moveTo(s.ax, s.ay); g.lineTo(s.bx, s.by); g.lineTo(i ? 350 : 20, s.by); g.lineTo(i ? 350 : 20, s.ay); g.closePath(); g.globalAlpha = 0.28; g.fill(); g.globalAlpha = 1;
        g.strokeStyle = lit ? '#fff6c8' : LOOK.sling; g.lineWidth = 5; g.beginPath(); g.moveTo(s.ax, s.ay); g.lineTo(s.bx, s.by); g.stroke();
      });
      /* targets (Comet's are stars) */
      TARGETS.forEach((p, i) => {
        const on = S.targets[i], flash = now - S.targetFlash[i] < 0.15;
        g.fillStyle = on ? '#fff2a0' : '#2a2150'; g.strokeStyle = on ? '#ffd23f' : LOOK.target; g.lineWidth = 3;
        g.shadowBlur = on && !reduced ? 14 : 0; g.shadowColor = '#ffd23f';
        g.beginPath(); g.arc(p.x, p.y, p.r + (flash ? 2 : 0), 0, 7); g.fill(); g.stroke(); g.shadowBlur = 0;
        if (MODE === 'comet') {
          g.fillStyle = on ? '#b86a00' : LOOK.target;
          g.beginPath();
          for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, q = k % 2 ? 2.6 : 6; g.lineTo(p.x + Math.cos(a) * q, p.y + Math.sin(a) * q); }
          g.closePath(); g.fill();
        }
      });
      /* Comet: the drop-target bank (a dropped one is a dim slot) and the saucer */
      DROPS.forEach((d, i) => {
        const up = S.drops[i];
        g.lineCap = 'butt';
        g.strokeStyle = up ? '#ffd06a' : 'rgba(255,208,106,.18)'; g.lineWidth = up ? 8 : 3;
        g.shadowBlur = up && !reduced ? 8 : 0; g.shadowColor = '#ffb03d';
        g.beginPath(); g.moveTo(d.ax, d.ay + 1); g.lineTo(d.bx, d.by - 1); g.stroke();
        g.shadowBlur = 0; g.lineCap = 'round';
      });
      if (SAUCER) {
        const held = S.held > 0;
        g.fillStyle = '#020a0c'; g.beginPath(); g.arc(SAUCER.x, SAUCER.y, SAUCER.r, 0, 7); g.fill();
        g.strokeStyle = held ? '#fff6c8' : LOOK.guide; g.lineWidth = 3; g.shadowBlur = reduced ? 0 : held ? 18 : 8; g.shadowColor = LOOK.guide;
        g.beginPath(); g.arc(SAUCER.x, SAUCER.y, SAUCER.r + 2, 0, 7); g.stroke(); g.shadowBlur = 0;
      }
      /* bumpers */
      BUMPERS.forEach((p, i) => {
        const flash = now - S.bumpFlash[i] < 0.12;
        g.shadowBlur = reduced ? 0 : (flash ? 26 : 12); g.shadowColor = LOOK.bump[2];
        const gr = g.createRadialGradient(p.x - 6, p.y - 7, 2, p.x, p.y, p.r);
        gr.addColorStop(0, flash ? '#fff' : LOOK.bump[0]); gr.addColorStop(1, flash ? '#ffd23f' : LOOK.bump[1]);
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

    /* ---------- did the ball get through something? (tests only: S.watch) ----------
       Every surface is a line with a thickness, and the ball's centre stays at least
       R + thickness from it, so in a step the centre can never cross a surface's own
       line, nor a seam: the short gap between two surfaces too close for the ball to
       pass (a guide's end and a flipper's pivot, a slingshot's top and a wall). A
       flipper moves, so for it the test is the side of it the ball is on, before and
       after. A ball whose centre ends up inside a bumper or a target went through it. */
    const upDrop = w => !DROPS.includes(w) || S.drops[DROPS.indexOf(w)];
    const segs = () => [...WALLS, ...SLINGS, ...DROPS.filter(upDrop), ...SEAMS.filter(m => m.own.every(upDrop))];
    function watchStep(x0, y0, fl0) {
      const b = S.ball, out = S.watch;
      for (const w of segs()) if (crosses(x0, y0, b.x, b.y, w.ax, w.ay, w.bx, w.by)) out.push({ through: w.seam ? 'seam' : 'wall', at: [w.ax, w.ay, w.bx, w.by], from: [x0, y0], to: [b.x, b.y] });
      for (const side of ['left', 'right']) {
        const A = fl0[side], B = flipperPts(side), sa = sideOf(A, x0, y0), sb = sideOf(B, b.x, b.y);
        if (sa.u > 0.02 && sa.u < 1 && sb.u > 0.02 && sb.u < 1 && Math.sign(sa.s) !== Math.sign(sb.s) && Math.abs(sa.s) > 1 && Math.abs(sb.s) > 1) out.push({ through: `${side} flipper`, from: [x0, y0], to: [b.x, b.y] });
      }
      for (const p of [...BUMPERS, ...TARGETS]) if (Math.hypot(b.x - p.x, b.y - p.y) < p.r) out.push({ through: 'bumper', at: [p.x, p.y], to: [b.x, b.y] });
      /* ...or round a corner, out of the cabinet: past a side, over the arch */
      if (b.x < 20 || b.x > 380 || (b.y < 200 && Math.hypot(b.x - 200, b.y - 200) > 180)) out.push({ through: 'the side', from: [x0, y0], to: [b.x, b.y] });
    }
    /* Balls fired at every corner of the table: at each end of every wall, slingshot, drop target
       and seam, and at the flippers' pivots and tips, from 36 directions at three speeds, with the
       flippers down, held up, and flicking. Each start is a free spot the ball can really reach
       (flooded from the plunger lane, the drain closed). -> { corners, shots, escapes: [first 20], n } */
    function cornerShots({ dirs = 36, speeds = [450, 900, 1400], secs = 0.5 } = {}) {
      const keep = { ...S, ball: { ...S.ball }, fl: { left: { ...S.fl.left }, right: { ...S.fl.right } }, drops: S.drops.slice(), targets: S.targets.slice() };
      newGame();                                   /* flippers at rest, every drop target up */
      const free = reachable();
      const pts = [];
      for (const w of [...WALLS, ...SLINGS, ...DROPS, ...SEAMS]) pts.push([w.ax, w.ay], [w.bx, w.by]);
      for (const side of ['left', 'right']) for (const a of [FL_REST, FL_UP]) { const P = PIVOT[side]; pts.push([P.x, P.y], [P.x + P.sx * FL * Math.cos(a), P.y + FL * Math.sin(a)]); }
      const corners = [...new Map(pts.map(([x, y]) => [`${Math.round(x)},${Math.round(y)}`, [x, y]])).values()];
      const escapes = [];
      let shots = 0;
      corners.forEach(([cx, cy], ci) => {
        for (let k = 0; k < dirs; k++) {
          const a = (k / dirs) * Math.PI * 2;
          for (const dist of [20, 30]) {
            const sx = cx + Math.cos(a) * dist, sy = cy + Math.sin(a) * dist;
            if (!free(sx, sy)) continue;
            for (const v of speeds) for (const mode of ['down', 'up', 'flick']) {
              /* an up flipper takes room the flooded grid (made with them down) counts as free */
              if (mode === 'up' && ['left', 'right'].some(side => { const P = PIVOT[side]; return segDist(sx, sy, { ax: P.x, ay: P.y, bx: P.x + P.sx * FL * Math.cos(FL_UP), by: P.y + FL * Math.sin(FL_UP) }) < R + 8.5; })) continue;
              newGame();
              S.state = 'play'; S.watch = [];
              S.ball = { x: sx, y: sy, vx: -Math.cos(a) * v, vy: -Math.sin(a) * v };
              const up = mode === 'up';
              S.keyL = S.keyR = up;
              if (up) for (const side of ['left', 'right']) S.fl[side] = { a: FL_UP, up: true, w: 0 };
              shots++;
              for (let t = 0, f = 0; t < secs && S.state === 'play'; t += DT, f++) {
                if (mode === 'flick' && f % 24 === (ci + k) % 24) { S.keyL = !S.keyL; S.keyR = !S.keyR; }
                physics(DT);
              }
              if (S.watch.length) escapes.push({ corner: [cx, cy], start: [sx, sy], dir: k, speed: v, mode, ...S.watch[0] });
            }
          }
        }
      });
      S.watch = null; S.keyL = S.keyR = false;
      Object.assign(S, keep);
      return { corners: corners.length, shots, n: escapes.length, escapes: escapes.slice(0, 20) };
    }
    /* where the ball's centre can be: clear of every surface, on the table, and joined to the
       plunger lane without going down the drain (a 2 px grid, flooded once) */
    function reachable() {
      const C = 2, NX = Math.ceil(TW / C), NY = Math.ceil(TH / C);
      const shut = [...segs(), { ax: flipperPts('left').qx, ay: flipperPts('left').qy, bx: flipperPts('right').qx, by: flipperPts('right').qy, t: 0 }];
      const fls = ['left', 'right'].map(flipperPts);
      const clear = (x, y) => {
        if (y < 200 && Math.hypot(x - 200, y - 200) > 180 - R - 3) return false;
        if (x < R || x > TW - R || y < R || y > TH - R) return false;
        for (const w of shut) if (segDist(x, y, w) < R + (w.t || 0) + 0.5) return false;
        for (const F of fls) if (segDist(x, y, { ax: F.px, ay: F.py, bx: F.qx, by: F.qy }) < R + 8.5) return false;
        for (const p of [...BUMPERS, ...TARGETS]) if (Math.hypot(x - p.x, y - p.y) < R + p.r + 0.5) return false;
        return true;
      };
      const seen = new Uint8Array(NX * NY), q = [];
      const at = (i, j) => j * NX + i;
      const i0 = Math.floor(LANE_X / C), j0 = Math.floor((LANE_REST - 20) / C);
      seen[at(i0, j0)] = 1; q.push([i0, j0]);
      while (q.length) {
        const [i, j] = q.pop();
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const a = i + di, c = j + dj;
          if (a < 0 || c < 0 || a >= NX || c >= NY || seen[at(a, c)]) continue;
          seen[at(a, c)] = clear(a * C + C / 2, c * C + C / 2) ? 1 : 2;
          if (seen[at(a, c)] === 1) q.push([a, c]);
        }
      }
      return (x, y) => { const i = Math.floor(x / C), j = Math.floor(y / C); return i >= 0 && j >= 0 && i < NX && j < NY && seen[at(i, j)] === 1 && clear(x, y); };
    }

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
        S.watch = [];
        step(1 / 60);
        const b = S.ball;
        if (S.watch.length) { escapes++; first = first || { f, ...S.watch[0] }; }
        S.watch = null;
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
        view: { ox: V.ox, oy: V.oy, s: V.s, top: TOP }, nudges: S.nudges.length, nudgesLeft: nudgesLeft(), msg: S.time - S.msgT < 1.6 ? S.msg : '',
        mode: MODE, bumpers: BUMPERS.length, drops: S.drops.slice(), held: S.held, extra: S.extra, saucer: SAUCER ? { ...SAUCER } : null,
      }),
      /* test hook — nothing in the game calls it:
         freeze(bool: the clock stops, step() drives) · step(seconds) · place({ x, y, vx, vy }) · plunge(power 0..1) ·
         reset() · fuzz({ frames, seed }) -> { escapes, nan, flips, drains, … } ·
         corners({ dirs, speeds, secs }) -> { corners, shots, n, escapes } */
      hook(cmd, arg) {
        if (cmd === 'freeze') S.frozen = !!arg;
        else if (cmd === 'step') { for (let t = 0; t < arg - 1e-9; t += 1 / 60) step(Math.min(1 / 60, arg - t)); }
        else if (cmd === 'place') { S.ball = { x: arg.x, y: arg.y, vx: arg.vx || 0, vy: arg.vy || 0 }; if (S.state === 'serve') S.state = 'play'; }
        else if (cmd === 'plunge') return launch(arg);
        else if (cmd === 'reset') newGame();
        else if (cmd === 'nudge') nudge();
        else if (cmd === 'fuzz') { const out = fuzz(arg || {}); draw(); return out; }
        else if (cmd === 'corners') { const out = cornerShots(arg || {}); draw(); return out; }
        else return false;
        draw();
        return true;
      },
    };
  },
};
