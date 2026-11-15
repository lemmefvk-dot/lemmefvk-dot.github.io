/* ============================================================
   arcade/kite.js — Kite Runner for Static Arcade.

   Steer a kite up and down through a sky that never stops moving.
   Fly through ribbons, ride the wind lanes (faster, and they push you
   up or down), and keep out of the storm clouds: each one that catches
   you costs a heart, and there are three. Rules, the course and the
   score are in ./kite-logic.js: 10 points a ribbon, 1 for every five
   metres.

   Controls
     keyboard       ↑ ↓ (or W S) steer; let go and the kite flies level
     mouse / touch  hold the button or finger down: the kite swings
                    towards it
   One-button option (ctx.oneButton): any key, click or tap — hold to
   climb, let go to sink.

   Seeds and ghosts (index.js SHARED OPTIONS): the sky comes from
   ctx.seed by distance, so the window's shape only changes how far
   ahead you see. The steering is logged by the 1/120 s step it changed
   in; onEnd({ replay: { v: 1, log: [[step, dir], …] } }) plays the run
   again exactly. ctx.ghost.watch plays it back on its own; otherwise a
   see-through kite flies the best run beside yours (ahead or behind you
   by the distance between you). ctx.speed slows the clock (and keeps
   the run from setting a best).

   All art is drawn in code. Reduced motion: no lightning flicker, no
   screen shake, still clouds.
   ============================================================ */
import { surface, looper, ownsKey, prompt, rr, hsl, FONT, clamp, rng, coarse, sounder } from './kit.js';
import { DT, VH, SEG, LIVES, segment, create, step, metres, scoreOf, INVULN } from './kite-logic.js';

const HUE = 195;
const SHELL_KEYS = new Set(['Escape', 'KeyP', 'Enter', 'NumpadEnter', 'Tab']);

export default {
  mount(el, ctx = {}) {
    const reduced = !!ctx.reduced || document.body.classList.contains('reduce-motion');
    const snd = sounder(ctx);
    const seed = Number.isInteger(ctx.seed) ? ctx.seed >>> 0 : (rng(Date.now() >>> 0)() * 2 ** 32) >>> 0;
    const speedK = clamp(Number(ctx.speed) || 1, 0.5, 1);
    const oneButton = !!ctx.oneButton;
    const GH = ctx.ghost && ctx.ghost.data && ctx.ghost.data.v === 1 && Array.isArray(ctx.ghost.data.log) && ctx.ghost.data.log.length < 50000 ? ctx.ghost : null;
    const watch = !!(GH && GH.watch);
    const glog = GH ? GH.data.log.filter(a => Array.isArray(a) && Number.isInteger(a[0]) && Number.isInteger(a[1])) : [];
    const G = GH && !watch ? create(seed) : null;
    let gk = 0, gdir = 0, wk = 0;
    const S = create(seed);
    const log = [];
    const st = { state: watch ? 'watch' : 'ready', paused: false, acc: 0, dir: 0, up: false, down: false, ptrY: null, hold: false, shake: 0, hitFlash: 0, time: 0, endT: 0, ended: false, trail: [] };
    let dead = false;
    const sf = surface(el, 'Kite Runner', () => draw());
    const KX = vw => clamp(vw * 0.26, 100, 240);
    const view = () => {
      const vw = clamp(VH * sf.w / Math.max(1, sf.h), 420, 1000);
      const k = Math.min(sf.w / vw, sf.h / VH);
      return { vw, k, ox: (sf.w - vw * k) / 2, oy: (sf.h - VH * k) / 2 };
    };
    ctx.onScore?.(0);

    /* ------------------------------ steering ------------------------------ */
    function wantDir() {
      if (watch) { while (wk < glog.length && glog[wk][0] <= S.t) { st.dir = glog[wk][1]; wk++; } return st.dir; }
      if (oneButton) return st.hold || st.up ? -1 : 1;
      if (st.ptrY !== null) { const dy = st.ptrY - S.y; return Math.abs(dy) < 14 ? 0 : dy < 0 ? -1 : 1; }
      return st.up && !st.down ? -1 : st.down && !st.up ? 1 : st.up && st.down ? st.last || 0 : 0;
    }
    function begin() {
      if (st.state !== 'ready') return;
      st.state = 'play';
      snd.wake();
    }

    /* ------------------------------ loop ------------------------------ */
    const loop = looper(raw => {
      if (st.paused) return;
      st.time += raw;
      st.shake = Math.max(0, st.shake - raw); st.hitFlash = Math.max(0, st.hitFlash - raw);
      if (st.state === 'play' || st.state === 'watch') {
        st.acc += raw * speedK;
        let n = 0;
        const dir = watch ? wantDir() : (st.dir = wantDir());
        if (!watch && (log.length ? log[log.length - 1][1] : 0) !== dir) log.push([S.t, dir]);
        while (st.acc >= DT && n++ < 14 && !S.over) {
          st.acc -= DT;
          if (watch) wantDir();
          step(S, watch ? st.dir : dir);
          if (G) { while (gk < glog.length && glog[gk][0] <= G.t) { gdir = glog[gk][1]; gk++; } step(G, gdir); G.events.length = 0; }
          if (S.t % 6 === 0) { st.trail.push(S.y); if (st.trail.length > 22) st.trail.shift(); }
          for (const ev of S.events.splice(0)) {
            if (ev.type === 'ribbon') { snd.blip(700 + 30 * Math.min(12, S.ribbons % 13), 0.05, 'triangle', 0.6, 1100); ctx.onScore?.(scoreOf(S)); }
            else if (ev.type === 'hit') { snd.blip(120, 0.25, 'sawtooth', 0.8, 60); if (!reduced) { st.shake = 0.25; st.hitFlash = 0.25; } ctx.announce?.(`Hit by a storm. ${S.lives} ${S.lives === 1 ? 'heart' : 'hearts'} left.`); }
          }
        }
        if (n >= 14) st.acc = 0;
        if (S.t % 30 === 0) ctx.onScore?.(scoreOf(S));
        if (S.over) finish();
      } else if (st.state === 'ready') st.time += 0;
      draw();
    });

    function finish() {
      if (st.ended) return;
      st.ended = true; st.state = 'over';
      ctx.onScore?.(scoreOf(S));
      draw();
      const score = scoreOf(S);
      st.endT = setTimeout(() => {
        if (dead) return;
        ctx.onEnd?.({
          score, won: false,
          detail: `${S.ribbons} ribbon${S.ribbons === 1 ? '' : 's'} · ${metres(S)} m flown · ${S.hits} storm hit${S.hits === 1 ? '' : 's'}`,
          ...(watch ? {} : { replay: { v: 1, log: log.map(a => a.slice()) } }), ...(speedK < 1 ? { assisted: true } : {}),
        });
      }, reduced ? 100 : 600);
    }

    /* ------------------------------ drawing ------------------------------ */
    const rnd = rng(11);
    const HILLS = Array.from({ length: 36 }, (_, i) => ({ x: i * 90, w: 90 + rnd() * 50, h: 40 + rnd() * 70 }));
    function kite(g, x, y, a = 1, tilt = 0, hurt = false) {
      g.save(); g.translate(x, y); g.rotate(tilt); g.globalAlpha = a;
      g.fillStyle = hurt ? '#ffffff' : '#ff4d6d'; g.beginPath(); g.moveTo(0, -17); g.lineTo(13, 0); g.lineTo(0, 17); g.lineTo(-13, 0); g.closePath(); g.fill();
      g.fillStyle = hurt ? '#ffffff' : '#ffd23f'; g.beginPath(); g.moveTo(0, -17); g.lineTo(13, 0); g.lineTo(0, 0); g.closePath(); g.fill();
      g.fillStyle = hurt ? '#ffffff' : '#3b9cff'; g.beginPath(); g.moveTo(0, 17); g.lineTo(-13, 0); g.lineTo(0, 0); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 1.3; g.beginPath(); g.moveTo(0, -17); g.lineTo(0, 17); g.moveTo(-13, 0); g.lineTo(13, 0); g.stroke();
      g.restore();
    }
    function cloud(g, x, y, r, t) {
      g.fillStyle = '#3a3550';
      for (const [dx, dy, k] of [[-0.55, 0.15, 0.75], [0, -0.1, 1], [0.55, 0.12, 0.8], [0.1, 0.35, 0.7]]) { g.beginPath(); g.arc(x + dx * r, y + dy * r, r * k, 0, 7); g.fill(); }
      g.fillStyle = '#242038'; g.beginPath(); g.arc(x, y + r * 0.45, r * 0.7, 0, 7); g.fill();
      /* a bolt: it flickers, unless the player asked for calm */
      if (reduced || Math.sin(t * 9 + x * 0.05) > 0.2) {
        g.strokeStyle = '#ffe36b'; g.lineWidth = 3; g.beginPath(); g.moveTo(x - 4, y + r * 0.3); g.lineTo(x + 5, y + r * 0.75); g.lineTo(x - 3, y + r * 0.8); g.lineTo(x + 6, y + r * 1.25); g.stroke();
      }
    }
    function ribbon(g, x, y, t) {
      g.save(); g.translate(x, y); g.rotate(Math.sin(t * 4 + x * 0.1) * (reduced ? 0 : 0.35));
      g.fillStyle = '#ff9ad5'; g.fillRect(-9, -3, 18, 6); g.fillStyle = '#ffd23f'; g.beginPath(); g.moveTo(9, -3); g.lineTo(14, -7); g.lineTo(14, 7); g.lineTo(9, 3); g.closePath(); g.fill();
      g.restore();
    }
    function draw() {
      sf.begin();
      const g = sf.g, v = view(), kx = KX(v.vw), d = S.d;
      const dusk = clamp(d / 60000, 0, 1);
      g.clearRect(0, 0, sf.w, sf.h);
      const bg = g.createLinearGradient(0, 0, 0, sf.h);
      bg.addColorStop(0, hsl(205 + dusk * 60, 70, 62 - dusk * 34)); bg.addColorStop(1, hsl(190 + dusk * 120, 70, 82 - dusk * 40));
      g.fillStyle = bg; g.fillRect(0, 0, sf.w, sf.h);
      const sx = st.shake > 0 && !reduced ? (Math.random() - 0.5) * 5 : 0;
      g.save(); g.translate(v.ox + sx, v.oy); g.scale(v.k, v.k);
      g.beginPath(); g.rect(0, 0, v.vw, VH); g.clip();
      /* hills, slower than the sky */
      for (const hh of HILLS) {
        const x = ((hh.x - d * 0.25) % 3240 + 3240) % 3240 - 100;
        g.fillStyle = hsl(150 - dusk * 20, 40, 30 - dusk * 14, 0.75); g.beginPath(); g.ellipse(x, VH, hh.w, hh.h, 0, Math.PI, 0); g.fill();
      }
      const toX = wd => kx + (wd - d);
      const first = Math.max(0, Math.floor((d - kx - 60) / SEG)), last = Math.floor((d + v.vw - kx + 60) / SEG);
      for (let i = first; i <= last; i++) {
        const sg = segment(seed, i);
        if (sg.wind) {
          const w = sg.wind, x0 = toX(w.d0), x1 = toX(w.d1);
          g.fillStyle = 'rgba(255,255,255,.12)'; rr(g, x0, w.y0, x1 - x0, w.y1 - w.y0, 14); g.fill();
          g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 2;
          for (let k = 0; k < 5; k++) {
            const yy = w.y0 + 16 + k * ((w.y1 - w.y0 - 32) / 4), off = reduced ? 0 : (st.time * 140 + k * 53) % 90;
            g.beginPath(); g.moveTo(x0 + 18 + off, yy); g.lineTo(x0 + 48 + off, yy + (w.push < 0 ? -6 : 6)); g.stroke();
          }
          g.fillStyle = 'rgba(255,255,255,.8)'; g.font = `700 14px ${FONT}`; g.textAlign = 'center'; g.fillText(w.push < 0 ? '↑ updraft' : '↓ downdraft', (x0 + x1) / 2, w.y0 - 6);
        }
        sg.ribbons.forEach((b, k) => { if (!S.got.has(i * 16 + k)) ribbon(g, toX(b.d), b.y, st.time); });
        for (const c of sg.storms) cloud(g, toX(c.d), c.y, c.r, st.time);
      }
      /* the string and tail */
      g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(kx, S.y + 17); g.quadraticCurveTo(kx - 60, VH - 10, kx - 120, VH + 20); g.stroke();
      g.strokeStyle = '#ff4d6d'; g.lineWidth = 3; g.beginPath(); g.moveTo(kx - 8, S.y);
      st.trail.slice().reverse().forEach((ty, k) => g.lineTo(kx - 14 - k * 9, ty)); g.stroke();
      if (G && !G.over) {
        const gx = clamp(kx + (G.d - S.d), 30, v.vw - 30);
        kite(g, gx, G.y, 0.4, 0);
        if (Math.abs(G.d - S.d) > 220) { g.fillStyle = 'rgba(255,255,255,.7)'; g.font = `700 11px ${FONT}`; g.textAlign = 'center'; g.fillText(G.d > S.d ? 'ghost ahead →' : '← ghost behind', gx, G.y - 24); }
      }
      if (!(S.invuln > 0 && Math.floor(S.invuln / 10) % 2 === 0 && !reduced)) kite(g, kx, S.y, S.over ? 0.35 : 1, clamp(S.vy / 700, -0.4, 0.4), st.hitFlash > 0);
      /* the readout */
      g.textAlign = 'left'; g.font = `800 16px ${FONT}`; g.fillStyle = '#fff';
      g.fillText(Array.from({ length: LIVES }, (_, i) => (i < S.lives ? '♥' : '♡')).join(' '), 14, 26);
      g.font = `700 13px ${FONT}`; g.fillText(`${S.ribbons} ribbons · ${metres(S)} m`, 14, 46);
      if (S.wind) { g.fillStyle = 'rgba(255,255,255,.9)'; g.fillText('wind!', 14, 64); }
      g.restore();
      if (st.state === 'ready') prompt(g, sf, 'Kite Runner', oneButton ? 'hold any key or the screen to climb, let go to sink' : coarse() ? 'hold your finger where you want the kite' : '↑ ↓ to steer · ribbons score · storms cost a heart', HUE);
      else if (st.paused) prompt(g, sf, 'Paused', 'Esc or P to carry on', HUE);
      else if (st.state === 'over') prompt(g, sf, 'Blown down', `${scoreOf(S)} points`, HUE);
    }

    /* ------------------------------ input ------------------------------ */
    const onKey = e => {
      if (!ownsKey(el, e) || watch) return;
      const c = e.code, UP = c === 'ArrowUp' || c === 'KeyW', DN = c === 'ArrowDown' || c === 'KeyS';
      const any = oneButton && !SHELL_KEYS.has(c) && !/^(Shift|Control|Alt|Meta|CapsLock)/.test(c);
      if (UP || DN || any || (c === 'Space' && st.state === 'ready')) {
        e.preventDefault();
        if (st.paused) return;
        if (st.state === 'ready') begin();
        if (UP || any) { st.up = true; st.last = -1; } else if (DN) { st.down = true; st.last = 1; }
      }
    };
    const onKeyUp = e => {
      const c = e.code;
      if (c === 'ArrowUp' || c === 'KeyW') st.up = false;
      else if (c === 'ArrowDown' || c === 'KeyS') st.down = false;
      else if (oneButton) st.up = false;
    };
    const setPtr = e => { const v = view(), r = sf.cv.getBoundingClientRect(); st.ptrY = clamp((e.clientY - r.top - v.oy) / v.k, 0, VH); };
    const onDown = e => {
      if (e.button > 0 || watch) return;
      e.preventDefault();
      if (st.paused) return;
      if (st.state === 'ready') begin();
      st.hold = true; setPtr(e);
      try { sf.cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointers */ }
    };
    const onMove = e => { if (st.hold) setPtr(e); };
    const onUp = () => { st.hold = false; st.ptrY = null; };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    sf.cv.addEventListener('pointerdown', onDown);
    sf.cv.addEventListener('pointermove', onMove);
    sf.cv.addEventListener('pointerup', onUp);
    sf.cv.addEventListener('pointercancel', onUp);
    draw();
    loop.start();

    return {
      stop() {
        if (dead) return; dead = true; clearTimeout(st.endT); loop.stop();
        window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp);
        sf.cv.removeEventListener('pointerdown', onDown); sf.cv.removeEventListener('pointermove', onMove);
        sf.cv.removeEventListener('pointerup', onUp); sf.cv.removeEventListener('pointercancel', onUp);
        snd.close(); sf.destroy();
      },
      pause() { if (dead || st.paused) return; st.paused = true; st.up = st.down = st.hold = false; st.ptrY = null; draw(); },
      resume() { if (dead || !st.paused) return; st.paused = false; st.acc = 0; },
      /* what a test may read: the kite, and what is ahead of it by distance */
      peek: () => {
        const ahead = [];
        for (let i = Math.floor(S.d / SEG); i <= Math.floor(S.d / SEG) + 2; i++) {
          const sg = segment(seed, i);
          sg.ribbons.forEach((b, k) => { if (!S.got.has(i * 16 + k) && b.d > S.d - 20) ahead.push({ kind: 'ribbon', dx: b.d - S.d, y: b.y }); });
          for (const c of sg.storms) if (c.d > S.d - c.r) ahead.push({ kind: 'storm', dx: c.d - S.d, y: c.y, r: c.r });
          if (sg.wind) ahead.push({ kind: 'wind', dx: sg.wind.d0 - S.d, dx1: sg.wind.d1 - S.d, y0: sg.wind.y0, y1: sg.wind.y1, push: sg.wind.push });
        }
        return {
          state: st.state, paused: st.paused, seed, y: S.y, vy: S.vy, d: S.d, lives: S.lives, ribbons: S.ribbons, hits: S.hits, score: scoreOf(S), metres: metres(S),
          wind: S.wind, invuln: S.invuln, steps: S.t, dir: st.dir, logged: log.length, log: log.map(a => a.slice()), over: S.over, ahead: ahead.sort((a, b) => a.dx - b.dx),
          ghost: G ? { y: G.y, d: G.d, over: G.over, score: scoreOf(G), t: G.t } : null, watch, oneButton, speed: speedK, vh: VH,
        };
      },
      /* test hook — nothing in the game calls it: skip(seconds) flies on with the steering as it is */
      hook(cmd, a) {
        if (cmd === 'skip') {
          const n = Math.round(Math.max(0, Number(a) || 0) / DT);
          /* the steering as the loop would take it now, logged like the loop logs it */
          if (!watch) { st.dir = wantDir(); if ((log.length ? log[log.length - 1][1] : 0) !== st.dir) log.push([S.t, st.dir]); }
          for (let i = 0; i < n && !S.over; i++) {
            if (watch) wantDir();
            step(S, st.dir);
            if (G) { while (gk < glog.length && glog[gk][0] <= G.t) { gdir = glog[gk][1]; gk++; } step(G, gdir); G.events.length = 0; }
          }
          if (S.over) finish();
          return true;
        }
        return false;
      },
    };
  },
};
