/* ============================================================
   arcade/basketball.js — Basketball for Static Arcade: a session of
   ten free throws.

   The shot meter swings up and down on its own clock (1.9 s a
   cycle, whatever the frame rate). Press Space / Enter / ↑, click
   or tap to release at the value it shows. The green band is the
   perfect release: a clean swish. A little outside it the ball
   rattles on the rim and may still drop in; further out it is short,
   long, or thrown off the glass. The ball flies as real physics
   (./basketball-sim.js: gravity, a rim made of two points, the
   backboard, the net, the floor) on a fixed 1/480 s step, so every
   miss is a miss you can see coming.

   Score: 2 points a basket, +1 for a clean swish (no rim, no glass)
   — 30 at most. Seven baskets or more counts as a win. Follows the
   module contract in ./index.js; stop() removes every listener, the
   loop and the audio context.
   ============================================================ */
import { clamp, hsl, FONT, coarse, surface, ownsKey, sounder, looper, rr, prompt, stepper } from './kit.js';
import * as B from './basketball-sim.js';

const HUE = 22;
const SHOTS = 10;
const WIN_MADE = 7;
const STEP = 1 / 120;
const LABEL = {
  swish: ['SWISH!', 140], bank: ['Off the glass — good!', 160], 'rim-in': ['Rattled in!', 120],
  'rim-out': ['Rim — no good', 20], 'board-out': ['Off the board — no good', 20],
  short: ['Short — airball', 0], long: ['Long — over the back', 0],
};

export default {
  mount(el, ctx) {
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    const S = {
      state: 'aim',                /* aim | flight | result | over */
      paused: false,
      shot: 0, made: 0, swishes: 0, points: 0, streak: 0, best: 0,
      meterT: 0, meterP: 0,
      locked: null,                /* the meter value of the last release */
      ball: null,                  /* the flying shot */
      outcome: null, banner: '', bannerHue: HUE, hint: '',
      resolved: false, timer: 0,
      time: 0, started: false, seenEvents: 0,
      log: [],                     /* [{ p, result }] */
      shake: 0,
    };
    const sf = surface(el, 'Basketball free throws', () => draw());
    report();
    function report() { ctx.onScore(S.points); }

    /* ------------------------------ rules ------------------------------ */
    function release(p) {
      if (S.paused || S.state !== 'aim') return false;
      S.locked = clamp(Number.isFinite(p) ? p : S.meterP, 0, 1);
      S.ball = B.newShot(S.locked);
      S.state = 'flight';
      S.started = true;
      S.resolved = false;
      S.seenEvents = 0;
      S.outcome = null; S.banner = '';
      S.hint = S.locked < B.GREEN_LO ? 'Released too soon' : S.locked > B.GREEN_HI ? 'Released too late' : 'Perfect release';
      snd.blip(300, 0.16, 'sine', 0.7, 520);
      return true;
    }

    function resolve() {
      const s = S.ball;
      S.resolved = true;
      const res = B.outcome(s);
      S.outcome = res;
      const scored = s.scored;
      S.shot++;
      if (scored) {
        S.made++; S.streak++; S.best = Math.max(S.best, S.streak);
        S.points += 2 + (res === 'swish' ? 1 : 0);
        if (res === 'swish') S.swishes++;
      } else S.streak = 0;
      S.log.push({ p: S.locked, result: res });
      const [text, hue] = LABEL[res];
      S.banner = text; S.bannerHue = hue;
      S.state = 'result';
      S.timer = reduced ? 1.1 : 1.5;
      report();
      if (scored) [660, 880, 1175].forEach((f, i) => setTimeout(() => snd.blip(f, 0.1, 'triangle', 0.9), i * 70));
      else snd.blip(150, 0.2, 'sine', 1, 90);
    }

    function next() {
      if (S.shot >= SHOTS) { finish(); return; }
      S.state = 'aim';
      S.meterT = 0;
      S.ball = null;
      S.banner = ''; S.hint = '';
    }

    function finish() {
      S.state = 'over';
      draw();
      snd.blip(220, 0.5, 'sawtooth', 0.8);
      ctx.onEnd({
        score: S.points, won: S.made >= WIN_MADE,
        detail: `${S.made} of ${SHOTS} made, ${S.swishes} clean swish${S.swishes === 1 ? '' : 'es'}, best streak ${S.best}. ${S.made >= WIN_MADE ? 'Cold from the line!' : `${WIN_MADE} baskets is the mark to beat.`}`,
      });
    }

    /* ------------------------------ one fixed step ------------------------------ */
    const clock = stepper(dt => {
      S.time += dt;
      if (S.state === 'aim') {
        S.meterT += dt;
        S.meterP = B.meterAt(S.meterT);
      } else if (S.state === 'flight' || S.state === 'result') {
        const s = S.ball;
        if (s && !s.done) B.stepShot(s, dt);
        if (s) {
          while (S.seenEvents < s.events.length) {
            const ev = s.events[S.seenEvents++];
            if (ev.kind === 'rim') snd.blip(880 + Math.random() * 200, 0.07, 'triangle', 1);
            else if (ev.kind === 'board') snd.blip(260, 0.09, 'square', 0.8);
            else if (ev.kind === 'net') snd.blip(1400, 0.22, 'sine', 0.6, 700);
            else if (ev.kind === 'floor') snd.blip(110, 0.06, 'sine', 0.8);
          }
        }
        if (S.state === 'flight' && s) {
          const low = s.passed && s.y < B.HOOP.y - 0.75;
          if (low || s.floor >= 1 || s.t > 3.5 || s.done) resolve();
        } else if (S.state === 'result') {
          S.timer -= dt;
          if (S.timer <= 0) next();
        }
      }
      if (S.shake > 0) S.shake = Math.max(0, S.shake - dt);
    }, STEP);

    const loop = looper(dt => {
      if (S.state !== 'over') clock.feed(dt);
      draw();
      if (S.state === 'over') loop.stop();
    });

    /* ------------------------------ drawing ------------------------------ */
    function view() {
      const w = sf.w, h = sf.h;
      const hudH = clamp(h * 0.11, 40, 64);
      const x0 = -1.9, x1 = 6.5, y0 = -0.45, y1 = 4.75;
      const s = Math.max(0.1, Math.min(w / (x1 - x0), (h - hudH) / (y1 - y0)));
      const ox = (w - (x1 - x0) * s) / 2 - x0 * s + 8;
      const oy = hudH + ((h - hudH) - (y1 - y0) * s) / 2 + y1 * s;
      return { s, ox, oy, hudH, w, h };
    }
    const X = (v, x) => v.ox + x * v.s;
    const Y = (v, y) => v.oy - y * v.s;

    function draw() {
      const g = sf.g;
      sf.begin();
      const v = view();
      g.save();
      if (S.shake > 0 && !reduced) g.translate((Math.random() - 0.5) * S.shake * 6, (Math.random() - 0.5) * S.shake * 6);
      drawCourt(g, v);
      drawHoopBack(g, v);
      drawPlayer(g, v);
      drawBall(g, v);
      drawHoopFront(g, v);
      g.restore();
      drawMeter(g, v);
      drawHud(g, v);
      if (S.banner && (S.state === 'result' || S.state === 'over')) banner(g, v);
      if (!S.started && S.state === 'aim') {
        const touch = coarse();
        prompt(g, sf, touch ? 'Tap when the meter is in the green' : 'Press Space when the meter is in the green', `Ten free throws · ${WIN_MADE} baskets to win · a clean swish scores a bonus`, HUE, v.hudH + (v.h - v.hudH) * 0.3);
      }
    }

    function drawCourt(g, v) {
      /* arena wall, then the crowd's dark band, then the floor */
      const wall = g.createLinearGradient(0, 0, 0, Y(v, 0));
      wall.addColorStop(0, '#120b1f'); wall.addColorStop(1, '#2a1830');
      g.fillStyle = wall;
      g.fillRect(0, 0, v.w, Y(v, 0));
      /* spotlights */
      for (const [lx, hue] of [[-1, 40], [2.4, 200], [5.6, 40]]) {
        const gr = g.createRadialGradient(X(v, lx), 0, 0, X(v, lx), Y(v, 0), v.s * 5);
        gr.addColorStop(0, hsl(hue, 90, 70, 0.18)); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(0, 0, v.w, Y(v, 0));
      }
      /* banners along the wall (nobody's team) */
      const cols = [200, 22, 300, 140, 50];
      for (let i = 0; i < 9; i++) {
        const bx = X(v, -1.8 + i * 1.0), top = v.hudH + 4;
        g.fillStyle = hsl(cols[i % cols.length], 55, 32, 0.9);
        g.beginPath(); g.moveTo(bx, top); g.lineTo(bx + v.s * 0.55, top); g.lineTo(bx + v.s * 0.55, top + v.s * 0.95); g.lineTo(bx + v.s * 0.275, top + v.s * 0.8); g.lineTo(bx, top + v.s * 0.95); g.closePath(); g.fill();
      }
      /* the floor */
      const fl = g.createLinearGradient(0, Y(v, 0), 0, v.h);
      fl.addColorStop(0, '#c98d4e'); fl.addColorStop(1, '#8a5a2e');
      g.fillStyle = fl;
      g.fillRect(0, Y(v, 0), v.w, v.h - Y(v, 0));
      g.strokeStyle = 'rgba(60,30,10,.28)'; g.lineWidth = 1;
      for (let i = 1; i < 14; i++) { const yy = Y(v, 0) + (v.h - Y(v, 0)) * (i / 14); g.beginPath(); g.moveTo(0, yy); g.lineTo(v.w, yy); g.stroke(); }
      /* the free-throw line and the key, flat on the floor */
      g.fillStyle = 'rgba(255,255,255,.85)';
      g.fillRect(X(v, B.REL.x - 0.02), Y(v, 0), 3, Math.max(8, v.s * 0.35));
      g.fillStyle = 'rgba(190,60,40,.5)';
      g.fillRect(X(v, B.REL.x), Y(v, 0) + 4, (B.BOARD.x + 0.9 - B.REL.x) * v.s, Math.max(6, (v.h - Y(v, 0)) * 0.3));
      g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 2;
      g.strokeRect(X(v, B.REL.x), Y(v, 0) + 4, (B.BOARD.x + 0.9 - B.REL.x) * v.s, Math.max(6, (v.h - Y(v, 0)) * 0.3));
      g.fillStyle = 'rgba(0,0,0,.25)';
      g.fillRect(0, Y(v, 0) - 2, v.w, 3);
    }

    function drawHoopBack(g, v) {
      const hx = B.HOOP.x, hy = B.HOOP.y;
      /* pole and arm */
      g.fillStyle = '#4b4f5a';
      g.fillRect(X(v, B.BOARD.x + 0.4), Y(v, 3.6), v.s * 0.1, Y(v, 0) - Y(v, 3.6));
      g.fillRect(X(v, B.BOARD.x), Y(v, 3.25), v.s * 0.5, v.s * 0.07);
      /* the glass */
      const bx = X(v, B.BOARD.x), by = Y(v, B.BOARD.y1), bw = Math.max(5, v.s * 0.05), bh = (B.BOARD.y1 - B.BOARD.y0) * v.s;
      g.fillStyle = 'rgba(200,230,255,.35)';
      g.fillRect(bx, by, bw, bh);
      g.fillStyle = 'rgba(255,255,255,.75)';
      g.fillRect(bx - 1, by, 2, bh);
      g.strokeStyle = 'rgba(255,90,60,.9)'; g.lineWidth = 2;
      g.strokeRect(bx - v.s * 0.28, Y(v, hy + 0.5), v.s * 0.28, v.s * 0.38);
      /* back half of the rim */
      g.strokeStyle = '#a53b12'; g.lineWidth = Math.max(3, v.s * 0.04);
      g.beginPath(); g.ellipse(X(v, hx), Y(v, hy), B.HOOP.r * v.s, v.s * 0.05, 0, Math.PI, 2 * Math.PI); g.stroke();
    }

    function drawHoopFront(g, v) {
      const hx = B.HOOP.x, hy = B.HOOP.y, r = B.HOOP.r * v.s;
      /* the net: swings with the ball, still in reduced motion */
      const sw = reduced ? 0 : (S.ball ? S.ball.net : 0) * 0.1 * v.s;
      g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1.2;
      const topY = Y(v, hy), botY = Y(v, hy - 0.42), mid = X(v, hx);
      const cols = 7;
      g.beginPath();
      for (let i = 0; i <= cols; i++) {
        const t = i / cols - 0.5;
        g.moveTo(mid + t * 2 * r, topY);
        g.quadraticCurveTo(mid + t * 1.3 * r + sw * 0.5, (topY + botY) / 2, mid + t * 0.9 * r + sw, botY);
      }
      for (let k = 1; k <= 3; k++) {
        const f = k / 4, yy = topY + (botY - topY) * f, wd = r * (1 - 0.4 * f);
        g.moveTo(mid - wd + sw * f, yy);
        g.quadraticCurveTo(mid + sw * f, yy + v.s * 0.04, mid + wd + sw * f, yy);
      }
      g.stroke();
      /* the front half of the rim */
      g.strokeStyle = '#e0561a'; g.lineWidth = Math.max(3, v.s * 0.04);
      g.beginPath(); g.ellipse(mid, topY, r, v.s * 0.05, 0, 0, Math.PI); g.stroke();
    }

    function drawPlayer(g, v) {
      /* an original little shooter: boxy jersey, round head, arms up */
      const px = B.REL.x - 0.35, gy = 0;
      const crouch = S.state === 'aim' ? Math.sin(S.time * 3) * 0.015 : 0;
      const up = S.state === 'flight' || S.state === 'result';
      const hue = 200;
      g.save();
      g.lineCap = 'round';
      g.fillStyle = 'rgba(0,0,0,.22)';
      g.beginPath(); g.ellipse(X(v, px), Y(v, 0) + 3, v.s * 0.33, v.s * 0.07, 0, 0, 7); g.fill();
      g.strokeStyle = '#3a2a22'; g.lineWidth = v.s * 0.13;
      g.beginPath(); g.moveTo(X(v, px - 0.1), Y(v, 0.95 + crouch)); g.lineTo(X(v, px - 0.14), Y(v, gy + 0.08)); g.moveTo(X(v, px + 0.1), Y(v, 0.95 + crouch)); g.lineTo(X(v, px + 0.16), Y(v, gy + 0.08)); g.stroke();
      g.fillStyle = '#f2f2f2';
      rr(g, X(v, px - 0.24), Y(v, 0.18), v.s * 0.22, v.s * 0.1, 4); g.fill();
      rr(g, X(v, px + 0.05), Y(v, 0.18), v.s * 0.26, v.s * 0.1, 4); g.fill();
      g.fillStyle = hsl(hue, 70, 48);
      rr(g, X(v, px - 0.26), Y(v, 1.62 + crouch), v.s * 0.52, v.s * 0.72, v.s * 0.1); g.fill();
      g.fillStyle = 'rgba(255,255,255,.9)'; g.font = `800 ${Math.round(v.s * 0.22)}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('7', X(v, px), Y(v, 1.25 + crouch));
      g.fillStyle = '#e0b48a';
      g.beginPath(); g.arc(X(v, px + 0.04), Y(v, 1.8 + crouch), v.s * 0.13, 0, 7); g.fill();
      g.fillStyle = '#2a1d16';
      g.beginPath(); g.arc(X(v, px + 0.02), Y(v, 1.85 + crouch), v.s * 0.13, Math.PI, 2 * Math.PI); g.fill();
      /* the shooting arm: to the ball, and up through the release */
      const hand = up ? { x: B.REL.x - 0.05, y: B.REL.y - 0.05 } : { x: px + 0.28, y: 1.62 + crouch + Math.sin(S.time * 3) * 0.02 };
      g.strokeStyle = '#e0b48a'; g.lineWidth = v.s * 0.09;
      g.beginPath(); g.moveTo(X(v, px + 0.12), Y(v, 1.52 + crouch)); g.lineTo(X(v, (px + 0.12 + hand.x) / 2 + 0.05), Y(v, (1.52 + hand.y) / 2 - 0.05)); g.lineTo(X(v, hand.x), Y(v, hand.y)); g.stroke();
      g.restore();
    }

    function drawBall(g, v) {
      let x, y, rot = 0;
      if (S.ball) { x = S.ball.x; y = S.ball.y; rot = S.ball.rot; }
      else { x = B.REL.x + 0.05; y = 1.68 + Math.sin(S.time * 3) * 0.02; }
      const px = X(v, x), py = Y(v, y), r = B.BALL_R * v.s;
      g.save();
      g.translate(px, py);
      g.rotate(rot);
      const gr = g.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
      gr.addColorStop(0, '#ffb066'); gr.addColorStop(1, '#c4531a');
      g.fillStyle = gr;
      g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
      g.beginPath(); g.arc(0, 0, r, 0, 7); g.clip();
      g.strokeStyle = 'rgba(60,20,5,.8)'; g.lineWidth = Math.max(1, r * 0.1);
      g.beginPath(); g.moveTo(-r, 0); g.lineTo(r, 0); g.moveTo(0, -r); g.lineTo(0, r);
      g.arc(-r * 1.25, 0, r * 0.95, -0.9, 0.9); g.moveTo(r * 0.95 + r * 0.3, 0);
      g.arc(r * 1.25, 0, r * 0.95, Math.PI - 0.9, Math.PI + 0.9);
      g.stroke();
      g.restore();
    }

    function drawMeter(g, v) {
      const mh = clamp(v.h * 0.5, 120, 340), mw = clamp(v.w * 0.04, 18, 28);
      const mx = 16, my = v.hudH + (v.h - v.hudH - mh) / 2;
      g.save();
      g.fillStyle = 'rgba(8,6,12,.72)';
      rr(g, mx - 6, my - 22, mw + 12, mh + 44, 10); g.fill();
      g.strokeStyle = 'rgba(255,255,255,.2)'; g.lineWidth = 1;
      rr(g, mx - 6, my - 22, mw + 12, mh + 44, 10); g.stroke();
      const track = (lo, hi) => [my + mh * (1 - hi), mh * (hi - lo)];
      g.fillStyle = 'rgba(255,255,255,.12)';
      rr(g, mx, my, mw, mh, mw / 2); g.fill();
      /* the zones: red short/long, amber near, green perfect */
      const [gy, gh] = track(B.GREEN_LO, B.GREEN_HI);
      const [ay, ah] = track(B.GREEN_LO - 0.08, B.GREEN_HI + 0.08);
      g.fillStyle = 'rgba(255,190,60,.35)'; g.fillRect(mx, ay, mw, ah);
      g.fillStyle = 'rgba(70,230,110,.85)'; g.fillRect(mx, gy, mw, gh);
      /* the marker */
      const p = S.state === 'aim' ? S.meterP : S.locked ?? S.meterP;
      const yy = my + mh * (1 - p);
      g.fillStyle = S.state === 'aim' ? '#fff' : (S.locked >= B.GREEN_LO && S.locked <= B.GREEN_HI ? '#8dffa8' : '#ffb0a0');
      g.beginPath(); g.moveTo(mx - 6, yy - 6); g.lineTo(mx + mw + 6, yy); g.lineTo(mx - 6, yy + 6); g.closePath(); g.fill();
      g.fillRect(mx, yy - 1.5, mw, 3);
      g.fillStyle = '#fff3d6'; g.font = `700 10px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      g.fillText('METER', mx + mw / 2, my - 8);
      g.fillStyle = 'rgba(255,255,255,.6)';
      if (S.state === 'aim') g.fillText(coarse() ? 'TAP' : 'SPACE', mx + mw / 2, my + mh + 16);
      g.restore();
    }

    function drawHud(g, v) {
      g.save();
      g.fillStyle = 'rgba(6,4,10,.78)';
      g.fillRect(0, 0, v.w, v.hudH);
      g.textBaseline = 'middle';
      const fs = Math.round(clamp(v.hudH * 0.34, 12, 22));
      g.font = `800 ${fs}px ${FONT}`;
      g.textAlign = 'left'; g.fillStyle = '#fff3d6';
      g.fillText(`Shot ${Math.min(SHOTS, S.shot + (S.state === 'aim' || S.state === 'flight' ? 1 : 0))} of ${SHOTS}`, 14, v.hudH / 2);
      g.textAlign = 'center';
      g.fillText(`Made ${S.made}`, v.w / 2, v.hudH / 2);
      g.fillStyle = S.streak >= 2 ? '#ffd23f' : 'rgba(255,255,255,.55)';
      g.font = `700 ${Math.round(fs * 0.8)}px ${FONT}`;
      g.fillText(S.streak >= 2 ? `${S.streak} in a row` : 'Streak 0', v.w / 2 + Math.min(150, v.w * 0.17), v.hudH / 2);
      /* the ten results as pips */
      const pw = Math.min(16, (v.w * 0.3) / SHOTS), px0 = v.w - 14 - pw * SHOTS;
      for (let i = 0; i < SHOTS; i++) {
        const r = S.log[i];
        g.fillStyle = !r ? 'rgba(255,255,255,.16)' : r.result === 'swish' || r.result === 'bank' || r.result === 'rim-in' ? (r.result === 'swish' ? '#7dffa0' : '#58d68a') : '#ff7a6b';
        g.beginPath(); g.arc(px0 + pw * i + pw / 2, v.hudH / 2, pw * 0.34, 0, 7); g.fill();
      }
      g.restore();
    }

    function banner(g, v) {
      const a = S.state === 'result' ? clamp(S.timer / 0.5, 0, 1) : 1;
      g.save();
      g.globalAlpha = a;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `900 ${Math.round(clamp(v.w * 0.06, 22, 46))}px ${FONT}`;
      g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.75)';
      const y = v.hudH + (v.h - v.hudH) * 0.2;
      g.strokeText(S.banner, v.w / 2, y); g.fillStyle = hsl(S.bannerHue, 100, 68); g.fillText(S.banner, v.w / 2, y);
      if (S.hint) {
        g.font = `700 ${Math.round(clamp(v.w * 0.022, 12, 17))}px ${FONT}`;
        g.lineWidth = 4;
        g.strokeText(S.hint, v.w / 2, y + 30); g.fillStyle = '#fff3d6'; g.fillText(S.hint, v.w / 2, y + 30);
      }
      g.restore();
    }

    /* ------------------------------ input ------------------------------ */
    const onKey = e => {
      if (!ownsKey(el, e)) return;
      if (e.code === 'Space' || e.code === 'Enter' || e.code === 'ArrowUp' || e.code === 'KeyW') {
        if (S.state === 'over') return;               /* Enter then belongs to the Arcade: play again */
        e.preventDefault();
        snd.wake();
        if (!e.repeat) release();
      }
    };
    const onDown = () => { snd.wake(); release(); };
    window.addEventListener('keydown', onKey);
    sf.cv.addEventListener('pointerdown', onDown);
    loop.start();

    return {
      stop() {
        loop.stop();
        window.removeEventListener('keydown', onKey);
        sf.cv.removeEventListener('pointerdown', onDown);
        snd.close();
        sf.destroy();
      },
      pause() { S.paused = true; loop.stop(); draw(); },
      resume() { S.paused = false; if (S.state !== 'over') loop.start(); },
      /* a read-only snapshot for automated play-tests (metres) */
      peek() {
        const b = S.ball;
        return {
          state: S.state, paused: S.paused, time: S.time, over: S.state === 'over', reduced,
          shot: S.shot, made: S.made, swishes: S.swishes, points: S.points, streak: S.streak,
          meterP: S.meterP, meterT: S.meterT, locked: S.locked, outcome: S.outcome, banner: S.banner, hint: S.hint,
          log: S.log.slice(),
          ball: b ? { x: b.x, y: b.y, vx: b.vx, vy: b.vy, t: b.t, rim: b.rim, board: b.board, floor: b.floor, scored: b.scored, crossX: b.crossX } : null,
          green: [B.GREEN_LO, B.GREEN_HI],
        };
      },
      /* test hook: inert unless a test calls it */
      hook(cmd, a) {
        if (cmd === 'release') return release(a);
        if (cmd === 'meter') { S.meterT = Math.max(0, a) * B.METER_PERIOD / 2; S.meterP = B.meterAt(S.meterT); return S.meterP; }
        if (cmd === 'feed') {
          const frame = a.frame || 1 / 60;
          for (let t = 0; t < a.secs - 1e-9; t += frame) clock.feed(Math.min(frame, a.secs - t));
          return true;
        }
        if (cmd === 'step') { for (let i = 0; i < Math.round(a / STEP); i++) clock.feed(STEP); return true; }
        if (cmd === 'settle') { for (let i = 0; i < 2000 && S.state === 'flight'; i++) clock.feed(STEP); return S.state; }
        if (cmd === 'next') { for (let i = 0; i < 600 && S.state === 'result'; i++) clock.feed(STEP); return S.state; }
        return null;
      },
    };
  },
};
