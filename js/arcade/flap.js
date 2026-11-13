/* ============================================================
   arcade/flap.js — Flap for Static Arcade.

   One button: Space (or ↑ / W), a click or a tap gives the bird a
   kick upward; gravity does the rest. Thread the gaps between the
   pipes. Score = pipes passed. The gaps narrow a little and the
   scroll speeds up a little as the score climbs, and each gap's
   height is kept within reach of the last one so every run is
   fair. The ceiling stops you but does not kill you; the pipes and
   the ground do.

   The world is 600 units tall and as wide as the play area's shape
   allows (clamped), so a wide window sees further ahead and a
   narrow one still plays. Follows the module contract in ./index.js.
   ============================================================ */

const HUE = 50;
const VH = 600, GROUND = 548;
const BIRD_R = 14;
const PIPE_W = 74, SPACING = 250;
const GRAVITY = 1500, KICK = -440, MAX_FALL = 720;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;
const FONT = 'Inter,ui-sans-serif,system-ui,sans-serif';
/* a touch screen is the main pointer: say "tap" and "swipe", not keys */
const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/* a fixed, seeded skyline + stars so every run looks the same */
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const rnd = seeded(7);
const STARS = Array.from({ length: 70 }, () => ({ x: rnd() * 1200, y: rnd() * 380, r: rnd() * 1.3 + 0.3, p: rnd() * 6 }));
const FAR = Array.from({ length: 40 }, (_, i) => ({ x: i * 34, w: 26 + rnd() * 18, h: 60 + rnd() * 110 }));
const NEAR = Array.from({ length: 26 }, (_, i) => ({ x: i * 58, w: 40 + rnd() * 26, h: 40 + rnd() * 90, lit: rnd() }));

export default {
  mount(el, ctx) {
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    const S = {
      state: 'ready',          /* ready | play | dying | over */
      paused: false,
      y: VH * 0.42, vy: 0,
      pipes: [], score: 0, dist: 0, time: 0,
      dieT: 0, flash: 0, wing: 0, flaps: 0,
      lastGap: VH * 0.42,
    };
    const sf = surface(el, 'Flap', () => draw());
    const view = () => {
      const vw = clamp(VH * sf.w / Math.max(1, sf.h), 380, 1100);
      const k = Math.min(sf.w / vw, sf.h / VH);
      return { vw, k, ox: (sf.w - vw * k) / 2, oy: (sf.h - VH * k) / 2 };
    };
    const birdX = vw => clamp(vw * 0.28, 110, 260);
    ctx.onScore(0);

    /* ------------------------------ rules ------------------------------ */
    const speed = () => Math.min(235, 170 + S.score * 2);
    const gapSize = () => Math.max(132, 172 - S.score * 1.2);

    function addPipe(x) {
      const gap = gapSize();
      const lo = 70 + gap / 2, hi = GROUND - 60 - gap / 2;
      const c = clamp(S.lastGap + (Math.random() * 2 - 1) * 210, lo, hi);
      S.lastGap = c;
      S.pipes.push({ x, top: c - gap / 2, bot: c + gap / 2, passed: false });
    }

    function flap() {
      if (S.paused) return;
      if (S.state === 'ready') {
        S.state = 'play';
        const { vw } = view();
        addPipe(vw + 80);
      }
      if (S.state !== 'play') return;
      S.vy = KICK;
      S.flaps++;
      S.wing = 1;
      snd.blip(560, 0.06, 'triangle', 0.7, 840);
    }

    function die() {
      if (S.state !== 'play') return;
      S.state = 'dying';
      S.dieT = 0;
      S.flash = reduced ? 0 : 0.25;
      if (S.vy < 0) S.vy = 0;
      snd.blip(240, 0.3, 'sawtooth', 0.9, 60);
    }

    function hits(p, bx, by) {
      const inX = bx + BIRD_R > p.x && bx - BIRD_R < p.x + PIPE_W;
      if (!inX) return false;
      const nx = clamp(bx, p.x, p.x + PIPE_W);
      const topHit = (() => { const ny = clamp(by, -999, p.top); return (bx - nx) ** 2 + (by - ny) ** 2 < BIRD_R * BIRD_R * 0.8; })();
      const botHit = (() => { const ny = clamp(by, p.bot, GROUND); return (bx - nx) ** 2 + (by - ny) ** 2 < BIRD_R * BIRD_R * 0.8; })();
      return topHit || botHit;
    }

    /* ------------------------------ loop ------------------------------ */
    const loop = looper(dt => {
      S.time += dt;
      const { vw } = view();
      const bx = birdX(vw);
      if (S.wing > 0) S.wing = Math.max(0, S.wing - dt * 4);
      if (S.flash > 0) S.flash = Math.max(0, S.flash - dt);

      if (S.state === 'ready') {
        S.y = VH * 0.42 + (reduced ? 0 : Math.sin(S.time * 3) * 8);
        S.dist += 60 * dt;
      } else if (S.state === 'play' || S.state === 'dying') {
        S.vy = Math.min(MAX_FALL, S.vy + GRAVITY * dt);
        S.y += S.vy * dt;
        if (S.y < BIRD_R) { S.y = BIRD_R; S.vy = Math.max(0, S.vy); }
        if (S.state === 'play') {
          const v = speed();
          S.dist += v * dt;
          for (const p of S.pipes) {
            p.x -= v * dt;
            if (!p.passed && p.x + PIPE_W < bx - BIRD_R) {
              p.passed = true;
              S.score++;
              ctx.onScore(S.score);
              snd.blip(990, 0.07, 'square', 0.6, 1320);
            }
            if (hits(p, bx, S.y)) die();
          }
          S.pipes = S.pipes.filter(p => p.x + PIPE_W > -40);
          const last = S.pipes[S.pipes.length - 1];
          if (!last || last.x < vw + 80 - SPACING) addPipe((last ? last.x : vw) + SPACING);
        }
        if (S.y + BIRD_R >= GROUND) {
          S.y = GROUND - BIRD_R;
          if (S.state === 'play') die();
          S.vy = 0;
        }
        if (S.state === 'dying') {
          S.dieT += dt;
          if (S.dieT > 0.9 && S.y >= GROUND - BIRD_R - 0.5) {
            S.state = 'over';
            draw();
            ctx.onEnd({ score: S.score, won: false, detail: S.score === 1 ? '1 pipe passed' : `${S.score} pipes passed` });
          }
        }
      }
      draw();
      if (S.state === 'over') loop.stop();
    });

    /* ------------------------------ drawing ------------------------------ */
    function draw() {
      const g = sf.g;
      sf.begin();
      const { vw, k, ox, oy } = view();
      g.fillStyle = '#05040c';
      g.fillRect(0, 0, sf.w, sf.h);
      g.save();
      g.translate(ox, oy);
      g.scale(k, k);
      g.beginPath();
      g.rect(0, 0, vw, VH);
      g.clip();

      /* sky */
      const sky = g.createLinearGradient(0, 0, 0, GROUND);
      sky.addColorStop(0, '#070716');
      sky.addColorStop(0.6, '#1a0f2e');
      sky.addColorStop(1, '#3b1d2c');
      g.fillStyle = sky;
      g.fillRect(0, 0, vw, VH);
      const moon = g.createRadialGradient(vw * 0.78, 110, 0, vw * 0.78, 110, 120);
      moon.addColorStop(0, hsl(HUE, 100, 70, 0.35));
      moon.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = moon;
      g.fillRect(0, 0, vw, VH);
      g.fillStyle = hsl(HUE, 90, 88, 0.9);
      g.beginPath(); g.arc(vw * 0.78, 110, 26, 0, Math.PI * 2); g.fill();
      for (const s of STARS) {
        if (s.x > vw) continue;
        const tw = reduced ? 0.7 : 0.45 + Math.sin(S.time * 2 + s.p) * 0.35;
        g.fillStyle = `rgba(255,250,230,${tw})`;
        g.fillRect(s.x, s.y, s.r * 2, s.r * 2);
      }

      /* parallax skyline */
      const far = (S.dist * 0.15) % (FAR.length * 34);
      g.fillStyle = '#150c24';
      for (let rep = 0; rep < 2; rep++) for (const b of FAR) {
        const x = b.x - far + rep * FAR.length * 34;
        if (x > vw || x + b.w < 0) continue;
        g.fillRect(x, GROUND - b.h - 30, b.w, b.h + 30);
      }
      const near = (S.dist * 0.4) % (NEAR.length * 58);
      for (let rep = 0; rep < 2; rep++) for (const b of NEAR) {
        const x = b.x - near + rep * NEAR.length * 58;
        if (x > vw || x + b.w < 0) continue;
        g.fillStyle = '#0d0818';
        g.fillRect(x, GROUND - b.h, b.w, b.h);
        g.fillStyle = hsl(HUE, 100, 65, 0.25 + b.lit * 0.3);
        for (let wy = GROUND - b.h + 10; wy < GROUND - 10; wy += 16) {
          for (let ix = 7; ix < b.w - 8; ix += 12) if (((b.x + ix) * 7 + wy * 3 | 0) % 5 < 2) g.fillRect(x + ix, wy, 4, 6);
        }
      }

      /* pipes */
      for (const p of S.pipes) {
        pipe(g, p.x, -10, p.top + 10, true);
        pipe(g, p.x, p.bot, GROUND - p.bot, false);
      }

      /* ground */
      g.fillStyle = '#0c0714';
      g.fillRect(0, GROUND, vw, VH - GROUND);
      g.save();
      g.shadowBlur = 12;
      g.shadowColor = hsl(HUE, 100, 55, 0.9);
      g.fillStyle = hsl(HUE, 100, 62);
      g.fillRect(0, GROUND, vw, 3);
      g.restore();
      g.fillStyle = hsl(HUE, 100, 60, 0.18);
      const off = S.dist % 28;
      for (let x = -off; x < vw; x += 28) {
        g.beginPath();
        g.moveTo(x, GROUND + 6); g.lineTo(x + 14, GROUND + 6); g.lineTo(x + 4, VH); g.lineTo(x - 10, VH);
        g.fill();
      }

      bird(g, birdX(vw), S.y);

      /* score in the sky (the HUD has it too; this one survives fullscreen) */
      if (S.state !== 'ready') {
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = `800 54px ${FONT}`;
        g.lineWidth = 6;
        g.strokeStyle = 'rgba(8,4,16,.85)';
        g.strokeText(String(S.score), vw / 2, 70);
        g.fillStyle = '#fffbe8';
        g.fillText(String(S.score), vw / 2, 70);
      }
      if (S.flash > 0) {
        g.fillStyle = `rgba(255,255,255,${S.flash * 2})`;
        g.fillRect(0, 0, vw, VH);
      }
      g.restore();

      if (S.state === 'ready') prompt(g, sf, coarse() ? 'Tap to flap' : 'Space, click or tap to flap', 'Fly through the gaps — the ground and pipes end the run', HUE, oy + VH * 0.66 * k);
    }

    function pipe(g, x, y, h, top) {
      if (h <= 0) return;
      const body = g.createLinearGradient(x, 0, x + PIPE_W, 0);
      body.addColorStop(0, '#1b1406');
      body.addColorStop(0.5, '#2b1f07');
      body.addColorStop(1, '#130e04');
      g.fillStyle = body;
      g.fillRect(x + 4, y, PIPE_W - 8, h);
      g.save();
      g.shadowBlur = 14;
      g.shadowColor = hsl(HUE, 100, 55, 0.8);
      g.strokeStyle = hsl(HUE, 100, 62);
      g.lineWidth = 2.5;
      g.strokeRect(x + 4, y, PIPE_W - 8, h);
      /* the cap at the open end */
      const cy = top ? y + h - 22 : y;
      g.fillStyle = '#2e2208';
      g.fillRect(x - 2, cy, PIPE_W + 4, 22);
      g.strokeRect(x - 2, cy, PIPE_W + 4, 22);
      g.restore();
      g.fillStyle = hsl(HUE, 100, 75, 0.25);
      g.fillRect(x + 12, y + (top ? 0 : 24), 5, Math.max(0, h - 24));
    }

    function bird(g, x, y) {
      const tilt = S.state === 'ready' ? 0 : clamp(S.vy / 700, -0.5, 1.1);
      g.save();
      g.translate(x, y);
      g.rotate(tilt);
      g.shadowBlur = 18;
      g.shadowColor = hsl(HUE, 100, 55, 0.8);
      g.fillStyle = hsl(HUE, 100, 60);
      g.beginPath(); g.ellipse(0, 0, BIRD_R + 3, BIRD_R, 0, 0, Math.PI * 2); g.fill();
      g.shadowBlur = 0;
      /* wing: up right after a flap, then settles */
      const wy = S.wing > 0 ? -8 * S.wing : (reduced ? 2 : Math.sin(S.time * 14) * 3);
      g.fillStyle = hsl(HUE - 12, 100, 48);
      g.beginPath(); g.ellipse(-5, 3 + wy * 0.5, 9, 5 + Math.abs(wy) * 0.3, -0.3, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff';
      g.beginPath(); g.arc(7, -5, 5.5, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#1a0f05';
      g.beginPath(); g.arc(8.5, -5, 2.6, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ff7a2e';
      g.beginPath(); g.moveTo(13, -1); g.lineTo(23, 2); g.lineTo(13, 6); g.closePath(); g.fill();
      g.restore();
    }

    /* ------------------------------ input ------------------------------ */
    const onKey = e => {
      if (!ownsKey(el, e)) return;
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
        e.preventDefault();
        if (e.repeat) return;
        snd.wake();
        flap();
      }
    };
    const onDown = e => {
      if (e.button > 0) return;
      e.preventDefault();
      snd.wake();
      flap();
    };
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
      /* a read-only snapshot for automated play-tests (world units) */
      peek: () => ({
        state: S.state, paused: S.paused, score: S.score, y: S.y, vy: S.vy, flaps: S.flaps,
        birdX: birdX(view().vw), birdR: BIRD_R, ground: GROUND, pipeW: PIPE_W,
        pipes: S.pipes.map(p => ({ x: p.x, top: p.top, bot: p.bot, passed: p.passed })),
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
