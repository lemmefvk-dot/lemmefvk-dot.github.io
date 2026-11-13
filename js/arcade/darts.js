/* ============================================================
   arcade/darts.js — Darts for Static Arcade: two games on one board.

   · Darts 501 (the default export): count 501 down to exactly zero,
     finishing on a double (the bull counts). Three darts a turn; a
     bust (below zero, on 1, or zero without a double) sends the
     score back to where the turn began. Score = darts thrown
     (fewer is better).
   · Around the Clock (the `clock` export): hit 1, 2 … 20 in order,
     then the bull. Score = darts thrown (fewer is better).
   The rules live in ./darts-rules.js, where they are tested alone.

   Aim: move the mouse (or ← ↑ ↓ →, Shift for fine steps) and press
   to throw (click, tap or Space). The reticle drifts a few
   millimetres around your aim point and the dart lands where the
   reticle is at the moment you throw, so time it. With reduced
   motion the reticle holds still and the dart lands on your aim.

   The world advances in fixed 1/120 s steps (./fixed.js), so the
   sway runs at the same speed on every screen.
   Follows the module contract in ./index.js.
   ============================================================ */
import { clamp, hsl, FONT, coarse, fitView, surface, ownsKey, sounder, looper, rr, prompt } from './kit.js';
import { fixedStepper } from './fixed.js';
import { ORDER, RAD, scoreAt, newMatch, applyDart, checkout, newClock, applyClock, clockName, CLOCK_TARGETS } from './darts-rules.js';

const VW = 900, VH = 600, BX = 300, BY = 300, SC = 1.35;     /* the board: centre and pixels per millimetre */
const DT = 1 / 120;
const AMP = 6;                                               /* mm of sway */
const FLIGHT = 0.14, PULL = 1.1;
const KEY_SPEED = 120, KEY_FINE = 30;                        /* mm per second */

const make = mode => ({
  mount(el, ctx) {
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    const S = {
      mode, state: 'aim',                         /* aim | flight | stuck | pull | done */
      paused: false, over: false, time: 0, t: 0,
      m: newMatch(501), c: newClock(),
      aim: { x: 0, y: -70 }, kx: 0, ky: 0, fine: false,
      turn: [], pend: null, flightT: 0, stuckT: 0, pullT: 0, endT: 0,
      msg: '', msgT: -9, last: null, calm: reduced, usedInput: false, hits: [],
    };
    const sf = surface(el, mode === '501' ? 'Darts board, 501' : 'Darts board, Around the Clock', () => draw());
    let V = fitView(sf, VW, VH, 6);
    let dead = false;
    ctx.onScore(0);

    const sway = () => {
      if (S.calm) return { x: 0, y: 0 };
      return { x: AMP * Math.sin(S.time * 1.25 + 0.7), y: AMP * Math.cos(S.time * 1.55) };
    };
    const thrown = () => (mode === '501' ? S.m.thrown : S.c.thrown);

    /* ------------------------------ rules glue ------------------------------ */
    function say(t) { S.msg = t; S.msgT = S.time; }
    function release(x, y) {
      if (S.state !== 'aim' || S.paused || S.over) return false;
      const lx = clamp(x, -240, 240), ly = clamp(y, -240, 240);
      S.pend = { x: lx, y: ly, d: scoreAt(lx, ly) };
      S.state = 'flight'; S.flightT = 0;
      snd.blip(200, 0.06, 'square', 0.5, 120);
      if (reduced) land();
      return true;
    }
    function land() {
      const p = S.pend;
      if (!p) return;
      S.pend = null;
      const d = p.d;
      S.turn.push({ x: p.x, y: p.y, d });
      S.hits.push({ x: p.x, y: p.y, label: d.label });
      S.last = d.label;
      S.state = 'stuck'; S.stuckT = 0;
      snd.blip(d.ring === 'miss' ? 110 : 150 + d.points * 4, 0.07, 'triangle', 0.7);
      if (mode === '501') {
        const r = applyDart(S.m, d);
        S.m = r.m;
        S.turnOverNow = r.turnOver;
        if (r.event === 'bust') { say(`Bust! Back to ${S.m.remaining}`); snd.blip(140, 0.3, 'sawtooth', 0.6, 70); }
        else if (r.event === 'win') { say(`${d.label}: finished!`); win(); }
        else say(d.points ? `${d.label}  ·  ${d.points}` : 'Miss');
      } else {
        const r = applyClock(S.c, d);
        S.c = r.c;
        S.turnOverNow = S.turn.length >= 3;
        if (r.hit) { say(`${d.label}: ${r.c.over ? 'the bull, round complete!' : `on to ${clockName(r.c.target)}`}`); snd.blip(520, 0.1, 'sine', 0.8, 760); if (r.c.over) win(); }
        else say(d.points ? `${d.label}: not the ${clockName(S.c.target)}` : 'Miss');
      }
      ctx.onScore(thrown());
    }
    function win() {
      S.state = 'done'; S.endT = 0;
      snd.blip(660, 0.18, 'triangle', 1, 990); snd.blip(990, 0.3, 'sine', 0.8, 1320);
    }
    function finish() {
      if (S.over || dead) return;
      S.over = true;
      const n = thrown();
      ctx.onEnd(mode === '501'
        ? { score: n, won: true, detail: `Down from 501 to zero in ${n} darts, finishing on a double.` }
        : { score: n, won: true, detail: `Every number from 1 to 20 and then the bull, in ${n} darts.` });
    }
    function nextTurn() {
      S.turn = []; S.state = 'aim'; S.turnOverNow = false;
      if (mode === '501') S.m = { ...S.m, dartsInTurn: 0 };
    }

    /* ------------------------------ the world, one fixed step ------------------------------ */
    function step(dt) {
      S.time += dt;
      if (S.state === 'aim') {
        const sp = (S.fine ? KEY_FINE : KEY_SPEED) * dt;
        if (S.kx || S.ky) { S.aim.x = clamp(S.aim.x + S.kx * sp, -230, 230); S.aim.y = clamp(S.aim.y + S.ky * sp, -230, 230); S.usedInput = true; }
      } else if (S.state === 'flight') {
        S.flightT += dt;
        if (S.flightT >= FLIGHT) land();
      } else if (S.state === 'stuck') {
        S.stuckT += dt;
        if (S.stuckT >= (reduced ? 0.15 : 0.35)) {
          if (S.turnOverNow) { S.state = 'pull'; S.pullT = 0; }
          else S.state = 'aim';
        }
      } else if (S.state === 'pull') {
        S.pullT += dt;
        if (S.pullT >= (reduced ? 0.45 : PULL)) nextTurn();
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
    function wedge(g, a0, a1, r0, r1) {
      g.beginPath();
      g.arc(BX, BY, r1 * SC, a0, a1);
      g.arc(BX, BY, r0 * SC, a1, a0, true);
      g.closePath();
    }
    function drawBoard(g) {
      g.fillStyle = '#0b0d12'; g.beginPath(); g.arc(BX, BY, (RAD.doubleOut + 32) * SC, 0, 7); g.fill();
      g.fillStyle = '#16181f'; g.beginPath(); g.arc(BX, BY, (RAD.doubleOut + 28) * SC, 0, 7); g.fill();
      const lit = new Set();
      if (mode === 'clock' && !S.c.over) lit.add(S.c.target);
      for (let i = 0; i < 20; i++) {
        const n = ORDER[i];
        const a0 = ((i * 18 - 9 - 90) * Math.PI) / 180, a1 = ((i * 18 + 9 - 90) * Math.PI) / 180;
        const even = i % 2 === 0;
        const dark = even ? '#15171c' : '#eadfc4', ring = even ? '#c8312f' : '#1f8a4a';
        const glow = lit.has(n);
        g.fillStyle = dark; wedge(g, a0, a1, RAD.outer, RAD.doubleIn); g.fill();
        g.fillStyle = ring; wedge(g, a0, a1, RAD.trebleIn, RAD.trebleOut); g.fill(); wedge(g, a0, a1, RAD.doubleIn, RAD.doubleOut); g.fill();
        if (glow) { g.fillStyle = 'rgba(255,230,120,.38)'; wedge(g, a0, a1, RAD.outer, RAD.doubleOut); g.fill(); }
        /* the number */
        const am = (a0 + a1) / 2;
        g.fillStyle = glow ? '#ffe28a' : '#f4f1e8'; g.font = `700 ${Math.round(15 * SC / 1.2)}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(String(n), BX + Math.cos(am) * (RAD.doubleOut + 15) * SC, BY + Math.sin(am) * (RAD.doubleOut + 15) * SC);
      }
      /* the wires */
      g.strokeStyle = 'rgba(210,214,224,.55)'; g.lineWidth = 1;
      for (const r of [RAD.trebleIn, RAD.trebleOut, RAD.doubleIn, RAD.doubleOut, RAD.outer, RAD.bull]) { g.beginPath(); g.arc(BX, BY, r * SC, 0, 7); g.stroke(); }
      for (let i = 0; i < 20; i++) {
        const a = ((i * 18 - 9 - 90) * Math.PI) / 180;
        g.beginPath(); g.moveTo(BX + Math.cos(a) * RAD.outer * SC, BY + Math.sin(a) * RAD.outer * SC); g.lineTo(BX + Math.cos(a) * RAD.doubleOut * SC, BY + Math.sin(a) * RAD.doubleOut * SC); g.stroke();
      }
      g.fillStyle = '#1f8a4a'; g.beginPath(); g.arc(BX, BY, RAD.outer * SC, 0, 7); g.fill();
      g.fillStyle = '#c8312f'; g.beginPath(); g.arc(BX, BY, RAD.bull * SC, 0, 7); g.fill();
      g.strokeStyle = 'rgba(210,214,224,.55)'; g.beginPath(); g.arc(BX, BY, RAD.outer * SC, 0, 7); g.stroke(); g.beginPath(); g.arc(BX, BY, RAD.bull * SC, 0, 7); g.stroke();
      if (mode === 'clock' && !S.c.over && S.c.target > 20) { g.strokeStyle = 'rgba(255,230,120,.9)'; g.lineWidth = 3; g.beginPath(); g.arc(BX, BY, RAD.outer * SC + 2, 0, 7); g.stroke(); }
    }
    function dartSprite(g, x, y, k = 1, ghost = false) {
      /* seen from the front: the flight and the barrel's tip */
      g.save(); g.translate(x, y); g.scale(k, k);
      g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.arc(2, 2, 3.4, 0, 7); g.fill();
      g.fillStyle = ghost ? 'rgba(255,255,255,.5)' : '#e9eef7'; g.beginPath(); g.arc(0, 0, 2.4, 0, 7); g.fill();
      g.strokeStyle = '#3ad6ff'; g.lineWidth = 2.2; g.lineCap = 'round';
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.78; g.beginPath(); g.moveTo(Math.cos(a) * 2, Math.sin(a) * 2); g.lineTo(Math.cos(a) * 8, Math.sin(a) * 8); g.stroke(); }
      g.restore();
    }
    function panel(g) {
      const x = 600, w = 280;
      g.fillStyle = 'rgba(255,255,255,.04)'; rr(g, x, 40, w, 520, 14); g.fill();
      g.strokeStyle = 'rgba(255,255,255,.1)'; g.lineWidth = 1; rr(g, x, 40, w, 520, 14); g.stroke();
      g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillStyle = hsl(40, 30, 72); g.font = `650 12px ${FONT}`;
      g.fillText(mode === '501' ? 'DARTS 501' : 'AROUND THE CLOCK', x + 20, 72);
      if (mode === '501') {
        g.fillStyle = '#f6f3ea'; g.font = `800 76px ${FONT}`; g.textAlign = 'center';
        g.fillText(String(S.m.remaining), x + w / 2, 150);
        g.font = `500 13px ${FONT}`; g.fillStyle = hsl(40, 25, 70); g.fillText('REMAINING', x + w / 2, 196);
        const co = S.m.remaining <= 170 ? checkout(S.m.remaining, 3 - S.m.dartsInTurn) : null;
        g.font = `600 14px ${FONT}`; g.fillStyle = co ? '#9be8a8' : hsl(40, 15, 60);
        g.fillText(co ? `Finish: ${co.join('  ')}` : S.m.remaining <= 170 ? 'No finish in reach' : 'Build towards a double', x + w / 2, 232);
      } else {
        g.fillStyle = '#f6f3ea'; g.font = `800 76px ${FONT}`; g.textAlign = 'center';
        g.fillText(S.c.over ? '✓' : clockName(S.c.target), x + w / 2, 150);
        g.font = `500 13px ${FONT}`; g.fillStyle = hsl(40, 25, 70); g.fillText(S.c.over ? 'ALL DONE' : 'NEXT TARGET', x + w / 2, 196);
        /* the 21 targets */
        const cw = 36, ch = 26, x0 = x + (w - cw * 7) / 2, y0 = 218;
        g.font = `700 12px ${FONT}`;
        for (let t = 1; t <= CLOCK_TARGETS; t++) {
          const i = t - 1, cx = x0 + (i % 7) * cw, cy = y0 + Math.floor(i / 7) * ch;
          const done = t < S.c.target || S.c.over, cur = t === S.c.target && !S.c.over;
          g.fillStyle = done ? 'rgba(80,200,120,.32)' : cur ? 'rgba(255,226,138,.3)' : 'rgba(255,255,255,.05)';
          rr(g, cx + 2, cy + 2, cw - 4, ch - 4, 6); g.fill();
          g.fillStyle = done ? '#b7f2c4' : cur ? '#ffe28a' : 'rgba(255,255,255,.55)';
          g.fillText(t === 21 ? 'Bull' : String(t), cx + cw / 2, cy + ch / 2 + 1);
        }
      }
      g.textAlign = 'left';
      /* this turn's darts */
      const ty = 330;
      g.fillStyle = hsl(40, 25, 70); g.font = `600 12px ${FONT}`; g.fillText('THIS TURN', x + 20, ty);
      for (let i = 0; i < 3; i++) {
        const dx = x + 20 + i * 82, d = S.turn[i];
        g.fillStyle = d ? 'rgba(255,255,255,.1)' : 'rgba(255,255,255,.04)'; rr(g, dx, ty + 14, 74, 40, 9); g.fill();
        g.textAlign = 'center'; g.fillStyle = d ? '#fff' : 'rgba(255,255,255,.3)'; g.font = `700 16px ${FONT}`;
        g.fillText(d ? d.d.label : '·', dx + 37, ty + 35);
      }
      g.textAlign = 'left';
      g.fillStyle = hsl(40, 25, 70); g.font = `600 12px ${FONT}`; g.fillText('DARTS THROWN', x + 20, 420);
      g.fillStyle = '#f6f3ea'; g.font = `800 34px ${FONT}`; g.fillText(String(thrown()), x + 20, 452);
      if (S.msg && S.time - S.msgT < 3) {
        g.fillStyle = /Bust/.test(S.msg) ? '#ff9a8a' : '#ffe28a'; g.font = `700 16px ${FONT}`;
        g.fillText(S.msg, x + 20, 506, w - 40);
      }
      g.fillStyle = 'rgba(255,255,255,.42)'; g.font = `500 11.5px ${FONT}`;
      g.fillText(S.calm ? 'Steady aim: the dart lands on your aim' : `The reticle drifts about ±${AMP} mm: time your throw`, x + 20, 540, w - 40);
    }
    function draw() {
      if (dead) return;
      const g = sf.g;
      sf.begin();
      V = fitView(sf, VW, VH, 6);
      g.fillStyle = '#0a0b10'; g.fillRect(0, 0, sf.w, sf.h);
      g.save(); g.translate(V.ox, V.oy); g.scale(V.s, V.s);
      g.beginPath(); g.rect(0, 0, VW, VH); g.clip();
      drawBoard(g);
      /* the darts in the board */
      S.turn.forEach(t => dartSprite(g, BX + t.x * SC, BY + t.y * SC, 1, S.state === 'pull'));
      if (S.state === 'flight' && S.pend) {
        const k = reduced ? 1 : 1 + 1.8 * (1 - S.flightT / FLIGHT);
        dartSprite(g, BX + S.pend.x * SC, BY + S.pend.y * SC, k);
      }
      if (S.state === 'aim' && !S.paused) {
        const sw = sway(), ax = BX + (S.aim.x + sw.x) * SC, ay = BY + (S.aim.y + sw.y) * SC;
        g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 1.6;
        g.beginPath(); g.arc(ax, ay, 9, 0, 7); g.stroke();
        g.beginPath(); g.moveTo(ax - 15, ay); g.lineTo(ax - 4, ay); g.moveTo(ax + 4, ay); g.lineTo(ax + 15, ay); g.moveTo(ax, ay - 15); g.lineTo(ax, ay - 4); g.moveTo(ax, ay + 4); g.lineTo(ax, ay + 15); g.stroke();
        g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.arc(ax, ay, 1.6, 0, 7); g.fill();
      }
      panel(g);
      if (S.state === 'pull') { g.fillStyle = 'rgba(255,255,255,.7)'; g.font = `600 14px ${FONT}`; g.textAlign = 'center'; g.fillText('Collecting darts…', BX, 580); }
      g.restore();
      if (!S.usedInput && thrown() === 0 && S.state === 'aim' && !S.paused) prompt(g, sf, coarse() ? 'Tap the board to throw' : 'Aim with the mouse, click to throw', mode === '501' ? 'Count 501 down to zero, finishing on a double' : 'Hit 1 to 20 in order, then the bull', 40, sf.h * 0.9);
      if (S.paused) prompt(g, sf, 'Paused', null, 40);
    }

    /* ------------------------------ input ------------------------------ */
    const toMm = e => {
      const r = sf.cv.getBoundingClientRect();
      return { x: ((e.clientX - r.left - V.ox) / V.s - BX) / SC, y: ((e.clientY - r.top - V.oy) / V.s - BY) / SC };
    };
    const throwNow = () => { const sw = sway(); return release(S.aim.x + sw.x, S.aim.y + sw.y); };
    const onMove = e => {
      if (S.state !== 'aim' || S.paused) return;
      const p = toMm(e); S.aim.x = clamp(p.x, -230, 230); S.aim.y = clamp(p.y, -230, 230); S.usedInput = true;
      if (!loop.on) draw();
    };
    const onDown = e => {
      if (e.button > 0 || S.paused) return;
      snd.wake();
      if (S.state === 'pull') { nextTurn(); return; }
      if (S.state !== 'aim') return;
      /* a touch has no hover: the press itself sets the aim */
      if (e.pointerType === 'touch' || e.pointerType === 'pen') { const p = toMm(e); S.aim.x = clamp(p.x, -230, 230); S.aim.y = clamp(p.y, -230, 230); }
      S.usedInput = true;
      throwNow();
    };
    const KEYS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], a: [-1, 0], d: [1, 0], w: [0, -1], s: [0, 1] };
    const onKey = e => {
      if (!ownsKey(el, e) || dead) return;
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
        if (S.state === 'pull') nextTurn(); else throwNow();
      }
    };
    const onKeyUp = e => {
      const k = KEYS[e.key];
      if (!k) return;
      if (k[0] && S.kx === k[0]) S.kx = 0;
      if (k[1] && S.ky === k[1]) S.ky = 0;
    };
    const onBlur = () => { S.kx = S.ky = 0; };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    sf.cv.addEventListener('pointermove', onMove);
    sf.cv.addEventListener('pointerdown', onDown);

    draw();
    loop.start();

    return {
      stop() {
        dead = true;
        loop.stop();
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onBlur);
        sf.cv.removeEventListener('pointermove', onMove);
        sf.cv.removeEventListener('pointerdown', onDown);
        snd.close();
        sf.destroy();
      },
      pause() { S.paused = true; S.kx = S.ky = 0; loop.stop(); draw(); },
      resume() { S.paused = false; stepper.reset(); if (!S.over) loop.start(); },
      peek: () => ({
        mode, state: S.state, paused: S.paused, over: S.over, time: S.time,
        remaining: S.m.remaining, turnStart: S.m.turnStart, dartsInTurn: S.m.dartsInTurn, target: S.c.target, clockDone: S.c.over, matchOver: S.m.over,
        thrown: thrown(), turn: S.turn.map(t => ({ label: t.d.label, points: t.d.points, x: t.x, y: t.y })), last: S.last, msg: S.msg,
        aim: { ...S.aim }, sway: sway(), amp: S.calm ? 0 : AMP, checkout: mode === '501' ? checkout(S.m.remaining, 3 - S.m.dartsInTurn) : null,
        view: { ox: V.ox, oy: V.oy, s: V.s, bx: BX, by: BY, sc: SC },
      }),
      /* test hook — nothing in the game calls it:
         throwAt({ x, y } mm) · step(seconds) · set({ remaining }) · target(n 1..21) · calm(bool) · skip() */
      hook(cmd, arg) {
        if (cmd === 'throwAt') return release(arg.x, arg.y);
        if (cmd === 'step') { for (let t = 0; t < arg - 1e-9; t += DT) step(DT); }
        else if (cmd === 'set') { S.m = { ...S.m, remaining: arg.remaining, turnStart: arg.remaining, dartsInTurn: 0 }; S.turn = []; }
        else if (cmd === 'target') S.c = { ...S.c, target: arg };
        else if (cmd === 'calm') S.calm = !!arg;
        else if (cmd === 'skip') { if (S.state === 'pull') nextTurn(); }
        else return false;
        draw();
        return true;
      },
    };
  },
});

export default make('501');
export const clock = make('clock');
