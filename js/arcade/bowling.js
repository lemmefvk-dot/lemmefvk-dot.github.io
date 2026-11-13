/* ============================================================
   arcade/bowling.js — Bowling for Static Arcade.

   Ten frames, ten pins, real scoring (./bowling-rules.js: strikes,
   spares, the three-ball tenth frame, a perfect 300) and real pin
   physics (./bowling-sim.js: the ball hits pins, pins hit pins,
   lying pins slide and hit others, the kickbacks bounce them, the
   gutters swallow the ball). The lane is drawn from above, in
   centimetres, and the camera follows the ball down to the pins.

   Throwing. Slide the ball along the foul line (A D, or the arrow
   buttons on the lane), choose where it should arrive at the head
   pin (← →, or move the mouse across the lane), pick a hook
   (Q E, or the hook buttons) and HOLD Space / the mouse button to
   build power; let go to throw. The dashed line is the path the
   ball will really take, hook included. Touch: drag to aim, hold
   to build power, lift to throw.

   The throw is a physical simulation on a fixed 1/480 s step, so a
   throw plays out the same on any screen. Score = pins (0–300);
   150 or more counts as a win. Follows the module contract in
   ./index.js; stop() removes every listener, the loop and the
   audio context.
   ============================================================ */
import { clamp, hsl, FONT, coarse, surface, ownsKey, sounder, looper, rr, prompt, stepper } from './kit.js';
import * as R from './bowling-rules.js';
import * as P from './bowling-sim.js';

const HUE = 28;
const WIN_SCORE = 150;
const SIM_STEP = 1 / 120;
const SPINS = [-1, -0.5, 0, 0.5, 1];
const SPIN_NAME = { '-1': 'Hook left', '-0.5': 'Curve left', 0: 'Straight', 0.5: 'Curve right', 1: 'Hook right' };
const speedOf = p => 450 + 450 * p;

export default {
  mount(el, ctx) {
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    const S = {
      state: 'aim',                 /* aim | charge | roll | settle | sweep | over */
      paused: false,
      rolls: [],
      standing: null,               /* pins standing before this ball: [{id,x,y}] or null for a full rack */
      world: P.newWorld(P.rack()),
      x0: 0, tx: 0, spin: 0,
      held: 0, power: 0,            /* seconds the throw key has been held */
      yb: -95,
      timer: 0, banner: '', bannerT: 0, bannerHue: HUE,
      keys: new Set(),
      time: 0, throws: 0, contactsSeen: 0, lastCrash: 0,
      last: null,                   /* what the last ball did: { pins, ids } */
      path: null,                   /* the aim preview */
      pathKey: '',
      started: false,
      hit: [],                      /* clickable buttons, rebuilt each frame */
    };
    const sf = surface(el, 'Bowling lane, seen from above', () => draw());
    report();

    const st = () => R.state(S.rolls);
    function report() { ctx.onScore(R.total(S.rolls)); }

    /* ------------------------------ rules ------------------------------ */
    function prepareBall() {
      const s = st();
      S.world = P.newWorld(s.fresh ? P.rack() : P.rack(S.standing));
      S.state = 'aim';
      S.held = 0; S.power = 0;
      S.yb = -95;
      S.pathKey = '';
      S.last = S.last && { ...S.last, shown: true };
    }

    function preview() {
      const key = `${S.x0.toFixed(1)}|${S.tx.toFixed(1)}|${S.spin}|${S.power.toFixed(2)}`;
      if (key === S.pathKey) return;
      S.pathKey = key;
      const speed = speedOf(S.power > 0 ? S.power : 0.55);
      const angle = P.aimAngle(S.x0, S.tx, speed, S.spin);
      S.path = P.ballPath({ x: S.x0, angle, speed, spin: S.spin }, 70);
    }

    /* the one way a ball leaves the foul line: keys, mouse, touch and tests all end up here */
    function throwBall(o = {}) {
      if (S.paused || (S.state !== 'aim' && S.state !== 'charge')) return false;
      const x0 = clamp(Number.isFinite(o.x) ? o.x : S.x0, -40, 40);
      const spin = Number.isFinite(o.spin) ? clamp(o.spin, -1, 1) : S.spin;
      const speed = clamp(Number.isFinite(o.speed) ? o.speed : speedOf(S.power || 0.55), 400, 1000);
      const tx = Number.isFinite(o.tx) ? o.tx : S.tx;
      const angle = Number.isFinite(o.angle) ? o.angle : P.aimAngle(x0, tx, speed, spin);
      P.launch(S.world, { x: x0, angle, speed, spin });
      S.x0 = x0; S.spin = spin; S.tx = tx;
      S.state = 'roll';
      S.started = true;
      S.throws++;
      S.contactsSeen = 0;
      snd.blip(130, 0.12, 'sine', 1.2, 90);
      return true;
    }

    function ballDone() {
      const w = S.world;
      const ids = P.knocked(w);
      const roll = ids.length;
      const s = st();
      S.rolls.push(roll);
      const after = st();
      const gutter = w.ball?.gutter && roll === 0;
      let msg, hue = HUE;
      const prevUp = s.up;
      if (roll === prevUp && prevUp === R.PINS) { msg = 'STRIKE!'; hue = 140; }
      else if (roll === prevUp) { msg = 'SPARE!'; hue = 200; }
      else if (roll === 0) { msg = gutter ? 'Gutter ball' : 'Missed them all'; hue = 0; }
      else msg = `${roll} pin${roll === 1 ? '' : 's'}`;
      S.last = { pins: roll, ids, msg };
      S.banner = msg; S.bannerT = reduced ? 2 : 2.4; S.bannerHue = hue;
      /* the pins left standing keep their places for the next ball */
      S.standing = after.over ? null : after.fresh ? null : P.standing(w);
      report();
      if (roll === prevUp) {
        [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => snd.blip(f, 0.12, 'triangle', 1), i * 90));
      } else if (roll === 0) snd.blip(110, 0.25, 'sine', 1, 70);
      S.state = 'sweep';
      S.timer = reduced ? 0.5 : 1.4;
    }

    function endGame() {
      S.state = 'over';
      draw();
      const score = R.total(S.rolls);
      const fr = R.frames(S.rolls);
      const strikes = fr.reduce((n, f) => n + f.marks.filter(m => m === 'X').length, 0);
      const spares = fr.reduce((n, f) => n + f.marks.filter(m => m === '/').length, 0);
      ctx.onEnd({ score, won: score >= WIN_SCORE, detail: `${strikes} strike${strikes === 1 ? '' : 's'}, ${spares} spare${spares === 1 ? '' : 's'}. ${score >= WIN_SCORE ? `${WIN_SCORE} or more — a good game!` : `${WIN_SCORE} is the mark to beat.`}` });
    }

    /* ------------------------------ one fixed step ------------------------------ */
    const clock = stepper(dt => {
      S.time += dt;
      const k = S.keys;
      if (S.state === 'aim' || S.state === 'charge') {
        if (k.has('ArrowLeft')) S.tx -= 45 * dt;
        if (k.has('ArrowRight')) S.tx += 45 * dt;
        if (k.has('KeyA')) S.x0 -= 40 * dt;
        if (k.has('KeyD')) S.x0 += 40 * dt;
        S.tx = clamp(S.tx, -60, 60);
        S.x0 = clamp(S.x0, -40, 40);
        if (S.state === 'charge') {
          S.held += dt;
          S.power = clamp(0.25 + S.held / 0.9 * 0.75, 0.25, 1);
        }
      } else if (S.state === 'roll') {
        P.advance(S.world, dt);
        const w = S.world;
        if (w.ball && !w.ball.gone) S.yb = clamp(w.ball.y - 150, -95, P.PIT_Y + 30 - viewCm());
        else S.yb = Math.max(S.yb, P.HEAD_Y - 330);
        S.yb = Math.min(S.yb, P.PIT_Y + 30 - viewCm());
        if (w.contacts > S.contactsSeen) {
          const n = w.contacts - S.contactsSeen;
          S.contactsSeen = w.contacts;
          if (S.time - S.lastCrash > 0.045) { S.lastCrash = S.time; snd.blip(180 + Math.random() * 520, 0.04, 'square', Math.min(1.2, 0.5 + n * 0.15)); }
        }
        if (P.settled(w)) ballDone();
      } else if (S.state === 'sweep') {
        S.timer -= dt;
        if (S.timer <= 0) {
          if (st().over) endGame(); else prepareBall();
        }
      }
      if (S.bannerT > 0) S.bannerT = Math.max(0, S.bannerT - dt);
    }, SIM_STEP);

    const loop = looper(dt => {
      if (S.state !== 'over') clock.feed(dt);
      if (S.state === 'aim' || S.state === 'charge') preview();
      draw();
      if (S.state === 'over') loop.stop();
    });

    /* ------------------------------ geometry ------------------------------ */
    const CM_W = P.LANE_W + 2 * P.GUTTER_W + 24;
    function box() {
      const w = sf.w, h = sf.h;
      const sbH = clamp(h * 0.12, 46, 78);
      const area = { x: 0, y: sbH + 8, w, h: Math.max(60, h - sbH - 8) };
      const s = clamp(Math.min(area.h / 560, (w - 24) / CM_W), 0.1, 1.5);
      return { w, h, sbH, area, s, cx: w / 2 };
    }
    function viewCm() { const b = box(); return b.area.h / b.s; }
    const lx = (b, x) => b.cx + x * b.s;
    const ly = (b, y) => b.area.y + b.area.h - (y - S.yb) * b.s;

    /* ------------------------------ drawing ------------------------------ */
    function draw() {
      const g = sf.g;
      sf.begin();
      const b = box();
      g.fillStyle = '#0a0806';
      g.fillRect(0, 0, b.w, b.h);
      S.hit = [];
      g.save();
      g.beginPath(); g.rect(0, b.area.y, b.w, b.area.h); g.clip();
      drawLane(g, b);
      drawPins(g, b);
      if (S.state === 'aim' || S.state === 'charge') drawAim(g, b);
      drawBall(g, b);
      g.restore();
      if (S.state === 'aim' || S.state === 'charge') drawControls(g, b);
      drawScore(g, b);
      if (S.state === 'aim' || S.state === 'charge') drawInset(g, b);
      if (S.bannerT > 0 && S.banner) {
        const a = clamp(S.bannerT / 0.6, 0, 1);
        g.save();
        g.globalAlpha = a;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = `900 ${Math.round(clamp(b.w * 0.075, 26, 52))}px ${FONT}`;
        g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.7)';
        const by = b.area.y + b.area.h * 0.38;
        g.strokeText(S.banner, b.cx, by);
        g.fillStyle = hsl(S.bannerHue, 100, 66);
        g.fillText(S.banner, b.cx, by);
        g.restore();
      }
      if (!S.started && S.state === 'aim') {
        const touch = coarse();
        prompt(g, sf, touch ? 'Drag to aim · hold, then lift to throw' : 'Aim with ← →, hold Space to throw', touch ? 'Ten frames · beat 150 to win' : 'A D slide the ball · Q E hook · or use the mouse · beat 150 to win', HUE, b.area.y + b.area.h * 0.34);
      }
    }

    function drawLane(g, b) {
      const L = P.LANE_W, G = P.GUTTER_W;
      const yTop = ly(b, P.PIT_Y + 80), yBot = ly(b, -400);
      /* the dark floor, the approach, the boards */
      g.fillStyle = '#17110c';
      g.fillRect(0, b.area.y, b.w, b.area.h);
      /* gutters */
      for (const sgn of [-1, 1]) {
        const x0 = lx(b, sgn * (L / 2)), x1 = lx(b, sgn * (L / 2 + G));
        const gr = g.createLinearGradient(x0, 0, x1, 0);
        gr.addColorStop(0, '#07090c'); gr.addColorStop(0.5, '#2a313a'); gr.addColorStop(1, '#0c0f13');
        g.fillStyle = gr;
        g.fillRect(Math.min(x0, x1), yTop, Math.abs(x1 - x0), yBot - yTop);
      }
      /* approach */
      g.fillStyle = '#d6a45e';
      g.fillRect(lx(b, -L / 2), ly(b, 0), L * b.s, yBot - ly(b, 0));
      /* the lane */
      const boards = 39, bw = L / boards;
      const yEnd = ly(b, P.PIT_Y), yStart = ly(b, 0);
      for (let i = 0; i < boards; i++) {
        const shade = [0, 6, -5, 3][i % 4];
        g.fillStyle = `hsl(32,58%,${58 + shade}%)`;
        g.fillRect(lx(b, -L / 2 + i * bw) - 0.3, yEnd, bw * b.s + 0.6, yStart - yEnd);
      }
      /* a lacquer sheen down the middle */
      const sh = g.createLinearGradient(lx(b, -L / 2), 0, lx(b, L / 2), 0);
      sh.addColorStop(0, 'rgba(255,255,255,0)'); sh.addColorStop(0.5, 'rgba(255,255,255,.13)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = sh;
      g.fillRect(lx(b, -L / 2), yEnd, L * b.s, yStart - yEnd);
      /* the lane's rails */
      g.fillStyle = '#4a3320';
      g.fillRect(lx(b, -L / 2) - 2, yEnd, 2.5, yStart - yEnd);
      g.fillRect(lx(b, L / 2) - 0.5, yEnd, 2.5, yStart - yEnd);
      /* dots and arrows */
      g.fillStyle = 'rgba(40,24,10,.75)';
      for (const y of [230, 255]) for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(lx(b, (i - 2) * 10), ly(b, y), 1.6 * b.s + 0.6, 0, 7); g.fill(); }
      for (let i = -3; i <= 3; i++) {
        const x = i * 13.5, y = P.ARROW_Y - Math.abs(i) * 18;
        g.beginPath(); g.moveTo(lx(b, x), ly(b, y + 28)); g.lineTo(lx(b, x - 4), ly(b, y)); g.lineTo(lx(b, x + 4), ly(b, y)); g.closePath(); g.fill();
      }
      /* the foul line */
      g.fillStyle = '#b8261c';
      g.fillRect(lx(b, -L / 2), ly(b, 0) - 1.5, L * b.s, 3);
      /* the pin deck's kickbacks and the pit */
      const dTop = ly(b, P.PIT_Y), dBot = ly(b, P.HEAD_Y - 70);
      g.fillStyle = '#3a2a1c';
      g.fillRect(lx(b, -64) - 3 * b.s, dTop, 3 * b.s, dBot - dTop);
      g.fillRect(lx(b, 64), dTop, 3 * b.s, dBot - dTop);
      const pit = g.createLinearGradient(0, dTop, 0, ly(b, P.PIT_Y + 80));
      pit.addColorStop(0, '#000'); pit.addColorStop(1, '#0d0907');
      g.fillStyle = pit;
      g.fillRect(lx(b, -L / 2 - G), ly(b, P.PIT_Y + 80), (L + 2 * G) * b.s, dTop - ly(b, P.PIT_Y + 80));
    }

    function pinPath(g, p, b, alpha) {
      const x = lx(b, p.x), y = ly(b, p.y);
      g.save();
      g.globalAlpha = alpha;
      g.translate(x, y);
      if (!p.fallen) {
        g.fillStyle = 'rgba(0,0,0,.28)';
        g.beginPath(); g.arc(1.5, 2, P.PIN_R * b.s * 1.02, 0, 7); g.fill();
        g.fillStyle = '#fbfaf5';
        g.beginPath(); g.arc(0, 0, P.PIN_R * b.s, 0, 7); g.fill();
        g.strokeStyle = '#d3321f'; g.lineWidth = Math.max(1, 2.2 * b.s);
        g.beginPath(); g.arc(0, 0, P.PIN_R * b.s * 0.62, 0, 7); g.stroke();
        g.fillStyle = '#e8e4d8';
        g.beginPath(); g.arc(0, 0, P.PIN_R * b.s * 0.3, 0, 7); g.fill();
      } else {
        g.rotate(p.ang);
        const len = 16 * b.s, wid = 5.4 * b.s;
        g.fillStyle = 'rgba(0,0,0,.25)';
        rr(g, -len + 1.5, -wid + 2, len * 2, wid * 2, wid); g.fill();
        g.fillStyle = '#f6f3ea';
        rr(g, -len, -wid, len * 2, wid * 2, wid); g.fill();
        g.fillStyle = '#d3321f';
        g.fillRect(len * 0.28, -wid, Math.max(1.5, 3.2 * b.s), wid * 2);
        g.fillRect(len * 0.28 + 6 * b.s, -wid, Math.max(1.5, 2 * b.s), wid * 2);
      }
      g.restore();
    }
    function drawPins(g, b) {
      const sweeping = S.state === 'sweep';
      const a = sweeping ? clamp(S.timer / (reduced ? 0.5 : 0.7), 0, 1) : 1;
      for (const p of S.world.pins) {
        if (p.gone) continue;
        if (p.fallen && sweeping && S.timer < 0.7 && !reduced) pinPath(g, p, b, a);
        else if (p.fallen && sweeping && reduced && S.timer < 0.25) continue;
        else pinPath(g, p, b, 1);
      }
    }

    function drawBall(g, b) {
      const w = S.world;
      let x = S.x0, y = 0, roll = 0, show = true;
      if (S.state === 'roll' || S.state === 'sweep') {
        if (!w.ball || w.ball.gone) show = false;
        else { x = w.ball.x; y = w.ball.y; roll = w.ball.roll; }
      } else y = -P.BALL_R - 3;
      if (!show) return;
      const px = lx(b, x), py = ly(b, y), r = P.BALL_R * b.s;
      g.save();
      g.fillStyle = 'rgba(0,0,0,.3)';
      g.beginPath(); g.arc(px + 2, py + 3, r, 0, 7); g.fill();
      const gr = g.createRadialGradient(px - r * 0.35, py - r * 0.35, r * 0.1, px, py, r);
      gr.addColorStop(0, '#6aa0ff'); gr.addColorStop(0.55, '#1d3f9a'); gr.addColorStop(1, '#0a1740');
      g.fillStyle = gr;
      g.beginPath(); g.arc(px, py, r, 0, 7); g.fill();
      /* finger holes turn with the roll */
      g.fillStyle = 'rgba(2,6,20,.85)';
      const a = roll * 0.8;
      for (const [ox, oy] of [[-0.28, -0.36], [0.28, -0.36], [0, 0.2]]) {
        const rx = ox * Math.cos(a) - oy * Math.sin(a), ry = ox * Math.sin(a) + oy * Math.cos(a);
        g.beginPath(); g.arc(px + rx * r, py + ry * r * 0.8, r * 0.13, 0, 7); g.fill();
      }
      g.restore();
    }

    function drawAim(g, b) {
      if (!S.path) return;
      g.save();
      g.setLineDash([6, 6]);
      g.lineWidth = 2;
      g.strokeStyle = hsl(S.state === 'charge' ? 50 : 200, 100, 72, 0.85);
      g.beginPath();
      S.path.pts.forEach((q, i) => { const X = lx(b, q.x), Y = ly(b, q.y - 0); if (i) g.lineTo(X, Y); else g.moveTo(X, Y); });
      g.stroke();
      g.setLineDash([]);
      const e = S.path.pts[S.path.pts.length - 1];
      g.fillStyle = hsl(50, 100, 70, 0.9);
      g.beginPath(); g.arc(lx(b, e.x), ly(b, e.y), 4, 0, 7); g.fill();
      g.restore();
    }

    function button(g, x, y, w, h, label, onClick, on = false) {
      g.save();
      g.fillStyle = on ? 'rgba(255,200,90,.28)' : 'rgba(10,8,6,.62)';
      g.strokeStyle = on ? 'rgba(255,215,120,.9)' : 'rgba(255,230,190,.35)';
      g.lineWidth = 1;
      rr(g, x, y, w, h, 7); g.fill(); g.stroke();
      g.fillStyle = '#fff3d6';
      g.font = `700 ${Math.round(clamp(h * 0.42, 11, 15))}px ${FONT}`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(label, x + w / 2, y + h / 2 + 1, w - 4);
      g.restore();
      S.hit.push({ x, y, w, h, onClick });
    }

    function drawControls(g, b) {
      const bh = clamp(b.s * 30, 26, 38), by = b.area.y + b.area.h - bh - 8;
      const bw = bh * 1.3;
      const ballX = lx(b, S.x0);
      /* slide the ball */
      button(g, clamp(ballX - bw - P.BALL_R * b.s - 6, 4, b.w - bw - 4), by - bh - 8, bw, bh, '◀', () => { S.x0 = clamp(S.x0 - 6, -40, 40); });
      button(g, clamp(ballX + P.BALL_R * b.s + 6, 4, b.w - bw - 4), by - bh - 8, bw, bh, '▶', () => { S.x0 = clamp(S.x0 + 6, -40, 40); });
      /* hook */
      const hw = clamp(b.w * 0.2, 88, 150);
      button(g, 8, by, bh, bh, '◀', () => { S.spin = SPINS[Math.max(0, SPINS.indexOf(S.spin) - 1)]; });
      g.save();
      g.fillStyle = 'rgba(10,8,6,.55)';
      rr(g, 8 + bh + 4, by, hw, bh, 7); g.fill();
      g.fillStyle = '#fff3d6'; g.font = `700 ${Math.round(clamp(bh * 0.4, 11, 14))}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(SPIN_NAME[S.spin] ?? 'Straight', 8 + bh + 4 + hw / 2, by + bh / 2 + 1, hw - 6);
      g.restore();
      button(g, 8 + bh + 8 + hw, by, bh, bh, '▶', () => { S.spin = SPINS[Math.min(SPINS.length - 1, SPINS.indexOf(S.spin) + 1)]; });
      /* power */
      const pw = clamp(b.w * 0.34, 120, 300), px = b.w - pw - 10, ph = clamp(bh * 0.55, 12, 18);
      g.save();
      g.fillStyle = 'rgba(10,8,6,.62)';
      rr(g, px - 4, by - 18, pw + 8, ph + 28, 8); g.fill();
      g.fillStyle = '#fff3d6'; g.font = `700 11px ${FONT}`; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      g.fillText(S.state === 'charge' ? 'Power — let go to throw' : 'Hold to build power', px, by - 5);
      g.fillStyle = 'rgba(255,255,255,.12)';
      rr(g, px, by + 2, pw, ph, ph / 2); g.fill();
      g.fillStyle = 'rgba(120,230,120,.28)';
      g.fillRect(px + pw * 0.45, by + 2, pw * 0.4, ph);
      if (S.state === 'charge') {
        const f = (S.power - 0.25) / 0.75;
        g.fillStyle = hsl(120 - 120 * f, 90, 55);
        rr(g, px, by + 2, Math.max(ph, pw * f), ph, ph / 2); g.fill();
      }
      g.restore();
    }

    function drawScore(g, b) {
      const fr = R.frames(S.rolls), s = st();
      const n = 11, pad = 8, gap = 3;
      const bw = Math.min(70, (b.w - pad * 2 - gap * (n - 1)) / n), bh = b.sbH - 6;
      const x0 = (b.w - (bw * n + gap * (n - 1))) / 2, y0 = 4;
      g.save();
      for (let f = 0; f < 11; f++) {
        const x = x0 + f * (bw + gap);
        const cur = f < 10 && !s.over && s.frame === f + 1;
        g.fillStyle = f === 10 ? 'rgba(255,200,90,.14)' : 'rgba(255,255,255,.08)';
        g.strokeStyle = cur ? hsl(HUE, 100, 62, 0.95) : 'rgba(255,255,255,.18)';
        g.lineWidth = cur ? 2 : 1;
        rr(g, x, y0, bw, bh, 6); g.fill(); g.stroke();
        g.textAlign = 'center'; g.textBaseline = 'middle';
        if (f < 10) {
          const F = fr[f];
          g.fillStyle = 'rgba(255,255,255,.4)';
          g.font = `600 ${Math.round(clamp(bw * 0.2, 8, 11))}px ${FONT}`;
          g.fillText(String(f + 1), x + bw / 2, y0 + 8);
          const cells = f === 9 ? 3 : 2, cw = bw / cells;
          g.font = `800 ${Math.round(clamp(bh * 0.3, 11, 17))}px ${FONT}`;
          F.marks.forEach((m, i) => {
            g.fillStyle = m === 'X' ? '#ffd23f' : m === '/' ? '#7ee2ff' : '#fff';
            g.fillText(m, x + cw * (f === 9 ? i : (m === 'X' ? 1 : i)) + cw / 2, y0 + bh * 0.42);
          });
          if (F.score !== null) {
            g.fillStyle = '#fff3d6';
            g.font = `800 ${Math.round(clamp(bh * 0.28, 11, 16))}px ${FONT}`;
            g.fillText(String(F.score), x + bw / 2, y0 + bh * 0.8);
          }
        } else {
          g.fillStyle = 'rgba(255,255,255,.55)';
          g.font = `600 ${Math.round(clamp(bw * 0.2, 8, 11))}px ${FONT}`;
          g.fillText('TOTAL', x + bw / 2, y0 + 8);
          g.fillStyle = '#ffd23f';
          g.font = `900 ${Math.round(clamp(bh * 0.46, 14, 26))}px ${FONT}`;
          g.fillText(String(R.total(S.rolls)), x + bw / 2, y0 + bh * 0.62);
        }
      }
      g.restore();
    }

    function drawInset(g, b) {
      const w = clamp(b.w * 0.24, 92, 220), h = w * 0.86;
      const x = b.w - w - 8, y = b.area.y + 6;
      const s = w / 128;
      g.save();
      g.fillStyle = 'rgba(8,6,4,.78)';
      g.strokeStyle = 'rgba(255,230,190,.35)';
      rr(g, x, y, w, h, 8); g.fill(); g.stroke();
      g.beginPath(); g.rect(x + 1, y + 1, w - 2, h - 2); g.clip();
      g.fillStyle = 'rgba(255,255,255,.55)'; g.font = `700 9px ${FONT}`; g.textAlign = 'left'; g.textBaseline = 'top';
      g.fillText('PINS', x + 6, y + 4);
      const ox = x + w / 2, oy = y + h - 14 - (0) ;
      const Y = yy => oy - (yy - (P.HEAD_Y - 22)) * s * 0.9;
      /* lane edges */
      g.strokeStyle = 'rgba(255,200,120,.35)';
      g.beginPath(); g.moveTo(ox - P.LANE_W / 2 * s, y + 14); g.lineTo(ox - P.LANE_W / 2 * s, y + h); g.moveTo(ox + P.LANE_W / 2 * s, y + 14); g.lineTo(ox + P.LANE_W / 2 * s, y + h); g.stroke();
      for (const p of S.world.pins) {
        if (p.gone || p.fallen) continue;
        g.fillStyle = '#fbfaf5';
        g.beginPath(); g.arc(ox + p.x * s, Y(p.y) - 4, P.PIN_R * s * 1.05, 0, 7); g.fill();
      }
      if (S.path) {
        const e = S.path.pts[S.path.pts.length - 1];
        g.strokeStyle = hsl(50, 100, 70, 0.95); g.lineWidth = 2;
        const px = ox + clamp(e.x, -70, 70) * s;
        g.beginPath(); g.moveTo(px, Y(P.HEAD_Y - 22) + 6); g.lineTo(px, Y(P.HEAD_Y + 90)); g.stroke();
        g.fillStyle = hsl(50, 100, 70, 0.95);
        g.beginPath(); g.arc(px, Y(P.HEAD_Y - 22) + 6, 3, 0, 7); g.fill();
      }
      g.restore();
    }

    /* ------------------------------ input ------------------------------ */
    const CTRL = new Set(['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD']);
    const beginCharge = () => {
      if (S.paused || S.state !== 'aim') return;
      S.state = 'charge'; S.held = 0; S.power = 0.25; S.started = true;
    };
    const release = () => {
      if (S.state !== 'charge') return;
      throwBall();
    };
    const onKey = e => {
      if (!ownsKey(el, e)) return;
      if (CTRL.has(e.code)) { e.preventDefault(); if (!S.paused) S.keys.add(e.code); snd.wake(); S.started = true; }
      else if (e.code === 'KeyQ' || e.code === 'KeyE') {
        e.preventDefault();
        if (!S.paused && (S.state === 'aim' || S.state === 'charge')) {
          const i = clamp(SPINS.indexOf(S.spin) + (e.code === 'KeyE' ? 1 : -1), 0, SPINS.length - 1);
          S.spin = SPINS[i];
        }
      } else if (e.code === 'Space' || e.code === 'Enter') {
        if (S.state === 'over') return;               /* Enter then belongs to the Arcade: play again */
        e.preventDefault();
        snd.wake();
        if (!e.repeat) beginCharge();
      }
    };
    const onKeyUp = e => {
      S.keys.delete(e.code);
      if (e.code === 'Space' || e.code === 'Enter') release();
    };
    const onBlur = () => { S.keys.clear(); if (S.state === 'charge') { S.state = 'aim'; S.held = 0; S.power = 0; } };
    const local = e => { const r = sf.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const aimAt = e => {
      if (S.paused || (S.state !== 'aim' && S.state !== 'charge')) return;
      const b = box(), p = local(e);
      S.tx = clamp((p.x - b.cx) / b.s, -60, 60);
    };
    const onDown = e => {
      snd.wake();
      if (S.paused) return;
      const p = local(e);
      const hit = S.hit.find(h => p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h);
      if (hit) { hit.onClick(); return; }
      if (S.state !== 'aim') return;
      aimAt(e);
      try { sf.cv.setPointerCapture?.(e.pointerId); } catch (err) { /* synthetic pointer */ }
      beginCharge();
    };
    const onUp = () => release();
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    sf.cv.addEventListener('pointerdown', onDown);
    sf.cv.addEventListener('pointermove', aimAt);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onBlur);

    loop.start();

    return {
      stop() {
        loop.stop();
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onBlur);
        sf.cv.removeEventListener('pointerdown', onDown);
        sf.cv.removeEventListener('pointermove', aimAt);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onBlur);
        snd.close();
        sf.destroy();
      },
      pause() { S.paused = true; S.keys.clear(); if (S.state === 'charge') { S.state = 'aim'; S.held = 0; S.power = 0; } loop.stop(); draw(); },
      resume() { S.paused = false; if (S.state !== 'over') loop.start(); },
      /* a read-only snapshot for automated play-tests (centimetres) */
      peek() {
        const s = st(), w = S.world, b = box();
        return {
          state: S.state, paused: S.paused, time: S.time, over: S.state === 'over', reduced,
          rolls: S.rolls.slice(), total: R.total(S.rolls), frame: s.frame, ball: s.ball, up: s.up, fresh: s.fresh,
          x0: S.x0, tx: S.tx, spin: S.spin, power: S.power, held: S.held, throws: S.throws, banner: S.banner,
          standing: w.pins.filter(p => !p.fallen && !p.gone).map(p => p.id),
          fallen: w.pins.filter(p => p.fallen).map(p => p.id),
          pins: w.pins.map(p => ({ id: p.id, x: p.x, y: p.y, fallen: p.fallen, gone: p.gone, byBall: p.hitByBall, byPin: p.hitByPin })),
          ballPos: w.ball ? { x: w.ball.x, y: w.ball.y, gutter: w.ball.gutter, gone: w.ball.gone } : null,
          simTime: w.t, contacts: w.contacts,
          view: { s: b.s, cx: b.cx, yb: S.yb, areaY: b.area.y, areaH: b.area.h },
          card: R.cardLine(S.rolls),
        };
      },
      /* test hook: inert unless a test calls it */
      hook(cmd, a) {
        if (cmd === 'throw') return throwBall(a || {});
        if (cmd === 'feed') {          /* run `secs` of game time in frames of `frame` seconds */
          const frame = a.frame || 1 / 60;
          for (let t = 0; t < a.secs - 1e-9; t += frame) clock.feed(Math.min(frame, a.secs - t));
          return true;
        }
        if (cmd === 'step') { for (let i = 0; i < Math.round(a / SIM_STEP); i++) clock.feed(SIM_STEP); return true; }
        if (cmd === 'settle') { for (let i = 0; i < 4000 && S.state === 'roll'; i++) clock.feed(SIM_STEP); return S.state; }
        if (cmd === 'next') { for (let i = 0; i < 400 && S.state === 'sweep'; i++) clock.feed(SIM_STEP); return S.state; }
        return null;
      },
    };
  },
};
