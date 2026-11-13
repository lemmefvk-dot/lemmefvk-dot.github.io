/* ============================================================
   arcade/archery.js — Archery for Static Arcade.

   Five ends of three arrows, from 20, 30, 40, 50 and 70 metres.
   Each arrow scores 10 (the gold) down to 1 by how close it lands
   to the middle of the face, and 0 for a miss: 150 is perfect.
   From the third end the target slides along a rail, so you have
   to lead it; and a crosswind blows the whole way. Score = points.

   The flight is real (./archery-sim.js): the arrow is pulled down by
   gravity and dragged sideways by the wind for as long as it is in the
   air, so a far target costs more drift, and the target is wherever
   it has got to when the arrow arrives. The sight is zeroed for each
   distance, so what moves the arrow off your aim is the wind (shown
   as an arrow and in m/s: it is the wind that acts on the arrow, live)
   and the tremor of your hand, which grows with the distance.

   Aim with the mouse (or ← ↑ ↓ →) and loose with a click, tap or
   Space. Hold Shift (or the right mouse button) to steady your aim
   for up to 2.5 seconds; it recovers when you let go. With reduced
   motion there is no tremor.
   Fixed 1/240-second steps. Follows the module contract in ./index.js.
   ============================================================ */
import { clamp, hsl, FONT, coarse, fitView, surface, ownsKey, sounder, looper, rr, prompt } from './kit.js';
import { fixedStepper } from './fixed.js';
import { ENDS, ARROWS_PER_END, DT, THETA, FACE_R, RING_W, windAt, targetAt, ringPoints, stepArrow, launch, solveAim } from './archery-sim.js';

const VW = 900, VH = 600, CX = 450, CY = 320, PPM = 190;       /* the target plane: centre and pixels per metre */
const AIM_MAX_X = 2.4, AIM_MAX_Y = 1.3;
const STEADY_MAX = 2.5;
const KEY_SPEED = 1.1;

export default {
  mount(el, ctx) {
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    const S = {
      state: 'aim',                                /* aim | flight | stuck | endcard | done */
      paused: false, over: false, time: 0,
      end: 0, shot: 0, total: 0, ends: [], pts: [],
      aim: { x: 0, y: 0 }, kx: 0, ky: 0, fine: false,
      stamina: STEADY_MAX, steady: false, calm: reduced,
      arrow: null, marks: [], stuckT: 0, cardT: 0, endT: 0, seed: (Math.random() * 1000) | 0,
      msg: '', msgT: -9, usedInput: false, lastHit: null,
    };
    const sf = surface(el, 'Archery range', () => draw());
    let V = fitView(sf, VW, VH, 6);
    let dead = false;
    ctx.onScore(0);

    const E = () => ENDS[S.end];
    const wind = () => windAt(S.time, E().wind, S.seed);
    const tgt = () => targetAt(S.time, E());
    const tremorAmp = () => (S.calm ? 0 : THETA * E().dist * (S.steady && S.stamina > 0 ? 0.25 : 1));
    const tremor = () => { const a = tremorAmp(); return { x: a * Math.sin(S.time * 2.1 + 0.4) * 0.7 + a * 0.3 * Math.sin(S.time * 5.3), y: a * Math.cos(S.time * 1.7) * 0.7 + a * 0.3 * Math.cos(S.time * 4.1 + 1) }; };

    /* ------------------------------ rules ------------------------------ */
    function say(t) { S.msg = t; S.msgT = S.time; }
    function loose(ax, ay) {
      if (S.state !== 'aim' || S.paused || S.over) return false;
      const { psi, theta } = solveAim(E().dist, clamp(ax, -4, 4), clamp(ay, -3, 3));
      S.arrow = launch(psi, theta);
      S.state = 'flight';
      snd.blip(300, 0.09, 'sawtooth', 0.5, 90);
      return true;
    }
    function arrive(a, prev) {
      const k = a.z === prev.z ? 0 : (E().dist - prev.z) / (a.z - prev.z);
      const x = prev.x + (a.x - prev.x) * k, y = prev.y + (a.y - prev.y) * k;
      const T = tgt();
      const rx = x - T.x, ry = y, r = Math.hypot(rx, ry);
      const pts = ringPoints(r);
      S.pts.push(pts);
      S.total += pts;
      S.marks.push({ rx, ry, pts });
      S.arrow = null;
      S.lastHit = { x, y, rx, ry, r, pts };
      S.state = 'stuck'; S.stuckT = 0;
      say(pts === 10 ? 'Gold! 10' : pts ? `${pts} points` : 'Missed the face');
      snd.blip(pts ? 160 + pts * 40 : 100, 0.1, 'triangle', 0.8);
      if (pts === 10) snd.blip(980, 0.2, 'sine', 0.6, 1400);
      ctx.onScore(S.total);
    }
    function afterStuck() {
      S.shot++;
      if (S.shot >= ARROWS_PER_END) {
        const endTotal = S.pts.slice(-ARROWS_PER_END).reduce((a, b) => a + b, 0);
        S.ends.push(endTotal);
        if (S.end >= ENDS.length - 1) { S.state = 'done'; S.endT = 0; snd.blip(660, 0.18, 'triangle', 1, 990); snd.blip(990, 0.3, 'sine', 0.8, 1320); }
        else { S.state = 'endcard'; S.cardT = 0; }
      } else S.state = 'aim';
    }
    function nextEnd() {
      if (S.state !== 'endcard') return;
      S.end++; S.shot = 0; S.marks = []; S.state = 'aim'; S.stamina = STEADY_MAX;
    }
    function finish() {
      if (S.over || dead) return;
      S.over = true;
      ctx.onEnd({ score: S.total, detail: `${S.total} of 150 points over five ends (${S.ends.join(', ')}), out to 70 metres.${S.pts.filter(p => p === 10).length ? ` ${S.pts.filter(p => p === 10).length} gold.` : ''}` });
    }

    /* ------------------------------ one fixed step ------------------------------ */
    function step(dt) {
      S.time += dt;
      if (S.state === 'aim' || S.state === 'flight') {
        if (S.steady && S.stamina > 0 && !S.calm) S.stamina = Math.max(0, S.stamina - dt);
        else if (!S.steady) S.stamina = Math.min(STEADY_MAX, S.stamina + dt * 0.6);
      }
      if (S.state === 'aim') {
        if (S.kx || S.ky) { const sp = (S.fine ? 0.3 : KEY_SPEED) * dt; S.aim.x = clamp(S.aim.x + S.kx * sp, -AIM_MAX_X, AIM_MAX_X); S.aim.y = clamp(S.aim.y + S.ky * sp, -AIM_MAX_Y, AIM_MAX_Y); S.usedInput = true; }
      } else if (S.state === 'flight' && S.arrow) {
        const prev = { ...S.arrow };
        stepArrow(S.arrow, wind(), dt);
        if (S.arrow.z >= E().dist) arrive(S.arrow, prev);
        else if (S.arrow.t > 6) { S.arrow = null; S.pts.push(0); S.marks.push({ rx: 9, ry: 9, pts: 0 }); S.state = 'stuck'; S.stuckT = 0; }
      } else if (S.state === 'stuck') {
        S.stuckT += dt;
        if (S.stuckT >= (reduced ? 0.3 : 0.8)) afterStuck();
      } else if (S.state === 'endcard') {
        S.cardT += dt;
        if (S.cardT >= 2.5) nextEnd();
      } else if (S.state === 'done') {
        S.endT += dt;
        if (S.endT >= (reduced ? 0.4 : 1.4)) finish();
      }
    }
    const stepper = fixedStepper(DT, step);
    const loop = looper(dt => {
      if (S.paused) return;
      stepper.advance(dt);
      draw();
    });

    /* ------------------------------ drawing ------------------------------ */
    const RING_COL = ['#f4f4ee', '#f4f4ee', '#1d1f24', '#1d1f24', '#2b7fd1', '#2b7fd1', '#d8322f', '#d8322f', '#f2c230', '#f2c230'];
    function drawArrowShape(g, x, y, k) {
      g.save(); g.translate(x, y); g.scale(k, k);
      g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.arc(1.5, 1.5, 4, 0, 7); g.fill();
      g.fillStyle = '#d9d4c0'; g.beginPath(); g.arc(0, 0, 2.6, 0, 7); g.fill();
      g.strokeStyle = '#e24b4b'; g.lineWidth = 2.4; g.lineCap = 'round';
      for (let i = 0; i < 3; i++) { const a = i * 2.094 + 0.5; g.beginPath(); g.moveTo(Math.cos(a) * 2, Math.sin(a) * 2); g.lineTo(Math.cos(a) * 9, Math.sin(a) * 9); g.stroke(); }
      g.restore();
    }
    function drawTarget(g) {
      const T = tgt(), E_ = E();
      /* the rail */
      if (E_.amp) {
        g.fillStyle = 'rgba(255,255,255,.07)'; rr(g, CX - (E_.amp + 0.1) * PPM - 14, CY + FACE_R * PPM + 14, (E_.amp + 0.1) * PPM * 2 + 28, 8, 4); g.fill();
      }
      const cx = CX + T.x * PPM, cy = CY;
      /* the stand */
      g.fillStyle = '#5a4630'; g.fillRect(cx - 4, cy + FACE_R * PPM - 6, 8, 120);
      g.fillStyle = '#3a2d1e'; g.fillRect(cx - 40, cy + FACE_R * PPM + 108, 80, 10);
      for (let i = 0; i < 10; i++) {
        g.fillStyle = RING_COL[i]; g.beginPath(); g.arc(cx, cy, (FACE_R - i * RING_W) * PPM, 0, 7); g.fill();
        g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 0.8; g.stroke();
      }
      g.fillStyle = 'rgba(0,0,0,.4)'; g.beginPath(); g.arc(cx, cy, 1.5, 0, 7); g.fill();
      /* arrows in the face */
      for (const m of S.marks) if (Math.abs(m.rx) < 4) drawArrowShape(g, cx + m.rx * PPM, cy - m.ry * PPM, 1);
    }
    function drawWind(g) {
      const w = wind(), max = E().wind;
      g.fillStyle = 'rgba(255,255,255,.05)'; rr(g, 20, 470, 190, 100, 12); g.fill();
      g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillStyle = hsl(200, 40, 75); g.font = `600 11px ${FONT}`; g.fillText('WIND (CROSSWIND)', 34, 488);
      g.fillStyle = '#f2f4f8'; g.font = `800 22px ${FONT}`;
      g.fillText(`${Math.abs(w).toFixed(1)} m/s`, 34, 520);
      g.font = `500 12px ${FONT}`; g.fillStyle = hsl(200, 30, 70);
      g.fillText(Math.abs(w) < 0.15 ? 'calm' : `blowing ${w > 0 ? 'to the right' : 'to the left'}`, 34, 546);
      /* an arrow whose length is the speed, on a scale to the strongest wind of this end */
      const len = max ? (w / 7) * 52 : 0;
      g.strokeStyle = w > 0 ? '#7be0ff' : '#ffb27b'; g.lineWidth = 3; g.lineCap = 'round';
      const ax = 160;
      g.beginPath(); g.moveTo(ax - len, 520); g.lineTo(ax + len, 520); g.stroke();
      if (Math.abs(len) > 3) { const s = Math.sign(len); g.beginPath(); g.moveTo(ax + len, 520); g.lineTo(ax + len - s * 9, 514); g.moveTo(ax + len, 520); g.lineTo(ax + len - s * 9, 526); g.stroke(); }
    }
    function drawHud(g) {
      g.textBaseline = 'middle';
      g.fillStyle = 'rgba(255,255,255,.05)'; rr(g, 20, 16, VW - 40, 46, 12); g.fill();
      g.font = `700 14px ${FONT}`; g.textAlign = 'left'; g.fillStyle = '#f2f4f8';
      g.fillText(`END ${S.end + 1} OF ${ENDS.length}`, 36, 39);
      g.font = `600 14px ${FONT}`; g.fillStyle = hsl(40, 80, 72);
      g.fillText(`${E().dist} m`, 160, 39);
      g.fillStyle = '#cfd6e2'; g.fillText(E().amp ? `target moving ±${E().amp} m` : 'target still', 226, 39);
      g.textAlign = 'right'; g.fillStyle = '#f2f4f8'; g.font = `700 14px ${FONT}`;
      g.fillText(`ARROW ${Math.min(S.shot + 1, ARROWS_PER_END)} OF ${ARROWS_PER_END}      TOTAL ${S.total}`, VW - 36, 39);
      if (S.msg && S.time - S.msgT < 2.4 && S.state !== 'endcard') {
        g.textAlign = 'center'; g.font = `700 20px ${FONT}`; g.fillStyle = S.lastHit?.pts === 10 ? '#ffe28a' : '#f2f4f8';
        g.fillText(S.msg, CX, 92);
      }
    }
    function drawStamina(g) {
      if (S.calm) return;
      const x = VW - 210, y = 470;
      g.fillStyle = 'rgba(255,255,255,.05)'; rr(g, x, y, 190, 100, 12); g.fill();
      g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillStyle = hsl(200, 40, 75); g.font = `600 11px ${FONT}`;
      g.fillText('STEADY (SHIFT / RIGHT BUTTON)', x + 14, y + 18);
      g.fillStyle = 'rgba(255,255,255,.1)'; rr(g, x + 14, y + 36, 162, 12, 6); g.fill();
      g.fillStyle = S.steady && S.stamina > 0 ? '#7be0ff' : '#6aa0c0'; rr(g, x + 14, y + 36, Math.max(2, 162 * S.stamina / STEADY_MAX), 12, 6); g.fill();
      g.fillStyle = hsl(200, 30, 70); g.font = `500 12px ${FONT}`;
      g.fillText(`hand tremor ±${(tremorAmp() * 100).toFixed(0)} cm at ${E().dist} m`, x + 14, y + 70);
    }
    function draw() {
      if (dead) return;
      const g = sf.g;
      sf.begin();
      V = fitView(sf, VW, VH, 6);
      g.fillStyle = '#0d1520'; g.fillRect(0, 0, sf.w, sf.h);
      g.save(); g.translate(V.ox, V.oy); g.scale(V.s, V.s);
      g.beginPath(); g.rect(0, 0, VW, VH); g.clip();
      const sky = g.createLinearGradient(0, 0, 0, VH); sky.addColorStop(0, '#16314d'); sky.addColorStop(0.62, '#3f6f8e'); sky.addColorStop(1, '#2d5a35');
      g.fillStyle = sky; g.fillRect(0, 0, VW, VH);
      g.fillStyle = '#2d5a35'; g.fillRect(0, CY + FACE_R * PPM + 100, VW, VH);
      drawTarget(g);
      /* the arrow in the air: it grows as it nears */
      if (S.arrow) {
        const a = S.arrow, k = 2.2 - 1.3 * (a.z / E().dist);
        drawArrowShape(g, CX + a.x * PPM, CY - a.y * PPM, k);
      }
      if (S.state === 'aim' && !S.paused) {
        const tr = tremor(), ax = CX + (S.aim.x + tr.x) * PPM, ay = CY - (S.aim.y + tr.y) * PPM;
        g.strokeStyle = 'rgba(255,255,255,.92)'; g.lineWidth = 1.6;
        g.beginPath(); g.arc(ax, ay, 12, 0, 7); g.stroke();
        g.beginPath(); g.moveTo(ax - 22, ay); g.lineTo(ax - 5, ay); g.moveTo(ax + 5, ay); g.lineTo(ax + 22, ay); g.moveTo(ax, ay - 22); g.lineTo(ax, ay - 5); g.moveTo(ax, ay + 5); g.lineTo(ax, ay + 22); g.stroke();
      }
      drawWind(g); drawStamina(g); drawHud(g);
      if (S.state === 'endcard') {
        g.fillStyle = 'rgba(8,12,18,.88)'; rr(g, CX - 170, 150, 340, 160, 14); g.fill();
        g.strokeStyle = 'rgba(255,255,255,.18)'; rr(g, CX - 170, 150, 340, 160, 14); g.stroke();
        g.textAlign = 'center'; g.fillStyle = '#f2f4f8'; g.font = `700 20px ${FONT}`;
        g.fillText(`End ${S.end + 1}: ${S.ends[S.end]} points`, CX, 188);
        g.font = `500 14px ${FONT}`; g.fillStyle = hsl(200, 30, 78);
        g.fillText(`${S.pts.slice(-3).join('  +  ')}   ·   total ${S.total}`, CX, 222);
        g.fillText(`Next: ${ENDS[S.end + 1].dist} m, wind up to ${ENDS[S.end + 1].wind} m/s${ENDS[S.end + 1].amp ? ', target moving' : ''}`, CX, 254);
        g.fillStyle = 'rgba(255,255,255,.6)'; g.font = `500 12.5px ${FONT}`;
        g.fillText(coarse() ? 'Tap to continue' : 'Click or press Space to continue', CX, 288);
      }
      g.restore();
      if (!S.usedInput && S.shot === 0 && S.end === 0 && S.state === 'aim' && !S.paused) prompt(g, sf, coarse() ? 'Tap to aim and loose' : 'Move to aim, click to loose', 'Read the wind: it pushes the arrow the whole way', 200, sf.h * 0.9);
      if (S.paused) prompt(g, sf, 'Paused', null, 200);
    }

    /* ------------------------------ input ------------------------------ */
    const toAim = e => {
      const r = sf.cv.getBoundingClientRect();
      return { x: ((e.clientX - r.left - V.ox) / V.s - CX) / PPM, y: -((e.clientY - r.top - V.oy) / V.s - CY) / PPM };
    };
    const shootNow = () => { const t = tremor(); return loose(S.aim.x + t.x, S.aim.y + t.y); };
    const onMove = e => {
      if (S.state !== 'aim' || S.paused) return;
      const p = toAim(e); S.aim.x = clamp(p.x, -AIM_MAX_X, AIM_MAX_X); S.aim.y = clamp(p.y, -AIM_MAX_Y, AIM_MAX_Y); S.usedInput = true;
      if (!loop.on) draw();
    };
    const onDown = e => {
      if (S.paused) return;
      snd.wake();
      if (e.button === 2) { S.steady = true; return; }
      if (e.button > 0) return;
      if (S.state === 'endcard') { nextEnd(); return; }
      if (S.state !== 'aim') return;
      if (e.pointerType === 'touch' || e.pointerType === 'pen') { const p = toAim(e); S.aim.x = clamp(p.x, -AIM_MAX_X, AIM_MAX_X); S.aim.y = clamp(p.y, -AIM_MAX_Y, AIM_MAX_Y); }
      S.usedInput = true;
      shootNow();
    };
    const onUp = e => { if (e.button === 2) S.steady = false; };
    const onCtx = e => e.preventDefault();
    const KEYS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1], a: [-1, 0], d: [1, 0], w: [0, 1], s: [0, -1] };
    const onKey = e => {
      if (!ownsKey(el, e) || dead) return;
      if (e.key === 'Shift') { S.steady = true; return; }
      const k = KEYS[e.key];
      if (k) {
        e.preventDefault(); snd.wake();
        if (S.paused) return;
        if (k[0]) S.kx = k[0]; else S.ky = k[1];
        S.fine = e.shiftKey;
        return;
      }
      if (e.key === ' ' || e.key === 'Enter') {
        if (S.over || S.state === 'done') return;           /* Enter plays again: the Arcade's */
        e.preventDefault(); snd.wake();
        if (S.paused || e.repeat) return;
        S.usedInput = true;
        if (S.state === 'endcard') nextEnd(); else shootNow();
      }
    };
    const onKeyUp = e => {
      if (e.key === 'Shift') { S.steady = false; return; }
      const k = KEYS[e.key];
      if (!k) return;
      if (k[0] && S.kx === k[0]) S.kx = 0;
      if (k[1] && S.ky === k[1]) S.ky = 0;
    };
    const onBlur = () => { S.kx = S.ky = 0; S.steady = false; };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    sf.cv.addEventListener('pointermove', onMove);
    sf.cv.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    sf.cv.addEventListener('contextmenu', onCtx);

    draw();
    loop.start();

    return {
      stop() {
        dead = true;
        loop.stop();
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onBlur);
        window.removeEventListener('pointerup', onUp);
        sf.cv.removeEventListener('pointermove', onMove);
        sf.cv.removeEventListener('pointerdown', onDown);
        sf.cv.removeEventListener('contextmenu', onCtx);
        snd.close();
        sf.destroy();
      },
      pause() { S.paused = true; S.kx = S.ky = 0; S.steady = false; loop.stop(); draw(); },
      resume() { S.paused = false; stepper.reset(); if (!S.over) loop.start(); },
      peek: () => ({
        state: S.state, paused: S.paused, over: S.over, time: S.time, end: S.end + 1, ends: S.ends.slice(), shot: S.shot, total: S.total, pts: S.pts.slice(),
        dist: E().dist, wind: wind(), windMax: E().wind, target: tgt(), amp: E().amp, aim: { ...S.aim }, tremor: tremor(), tremorAmp: tremorAmp(),
        stamina: S.stamina, arrow: S.arrow ? { x: S.arrow.x, y: S.arrow.y, z: S.arrow.z, t: S.arrow.t } : null, lastHit: S.lastHit, marks: S.marks.map(m => ({ ...m })),
        view: { ox: V.ox, oy: V.oy, s: V.s, cx: CX, cy: CY, ppm: PPM },
      }),
      /* test hook — nothing in the game calls it:
         loose({ x, y } metres, exact: no tremor) · step(seconds) · calm(bool) · seed(n) · next() */
      hook(cmd, arg) {
        if (cmd === 'loose') return loose(arg.x, arg.y);
        if (cmd === 'step') { for (let t = 0; t < arg - 1e-9; t += DT) step(DT); }
        else if (cmd === 'calm') S.calm = !!arg;
        else if (cmd === 'seed') S.seed = arg;
        else if (cmd === 'next') nextEnd();
        else if (cmd === 'time') S.time = +arg || 0;
        else return false;
        draw();
        return true;
      },
    };
  },
};
