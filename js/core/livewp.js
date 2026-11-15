/* ============================================================
   livewp.js — the animated wallpapers that are drawn, not filmed.

     rain      rain running down a window, with a blurred city behind it
     fireflies a dark wood, and little lights wandering through it
     city      a skyline at night: windows lighting and going dark,
               headlights on the road

   Every one is original and drawn here on a canvas — no video file,
   nothing downloaded, so each costs a few KB of code and the same GPU
   as a game would. They follow the rules every moving thing on the
   desktop follows:

   · Reduce motion (this OS's switch or the computer's own) draws ONE
     still frame and never starts the animation loop;
   · the loop pauses while the tab is hidden, in Game Mode, and while
     the wallpaper's own motion switch is off (the `.wp--still` class
     desktop.js puts on the wallpaper), and starts again by itself;
   · it stops for good when the layer leaves the page.

     layer(h, base, id) -> the element desktop.js puts under the icons
     SCENES             -> { id: { name, blurb, css } } for the pickers
     paint(canvas, id)  -> one still frame (also what the pickers can use)
   ============================================================ */

export const SCENES = {
  rain: {
    name: 'Rain on Glass', blurb: 'A rainy window over a blurred city at night.',
    css: 'radial-gradient(40% 30% at 30% 70%, rgba(255,170,90,.35), transparent 70%),radial-gradient(35% 28% at 72% 62%, rgba(110,170,255,.32), transparent 70%),linear-gradient(180deg,#0c1220,#0a0f1c 60%,#06080f)',
  },
  fireflies: {
    name: 'Fireflies', blurb: 'A dark wood on a summer night, and lights drifting through it.',
    css: 'radial-gradient(30% 24% at 40% 60%, rgba(220,255,120,.35), transparent 70%),radial-gradient(22% 18% at 70% 45%, rgba(220,255,120,.25), transparent 70%),linear-gradient(180deg,#07130f,#08170f 55%,#030a07)',
  },
  city: {
    name: 'City at Night', blurb: 'Rooftops under the stars, windows lit, headlights moving below.',
    css: 'linear-gradient(180deg,#0b1030 0%,#1a1c45 45%,#3a2a58 75%,#1b1430 100%)',
  },
};
export const IDS = Object.keys(SCENES);

/* a small seeded generator: the decor must be the same every time the size is */
const seeded = seed => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rnd = (a, b) => a + Math.random() * (b - a);

export const reducedMotion = () => (typeof document !== 'undefined' && document.body?.classList.contains('reduce-motion'))
  || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

/* ---------------- scenes ----------------
   each: build(S) once per size (draws S.back, an offscreen canvas of what does not move),
         step(S, dt) moves the little things, draw(g, S, now) paints a frame */
const SCENE = {
  rain: {
    build(S) {
      const { w, h, back } = S, g = back.getContext('2d'), R = seeded(11);
      const sky = g.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#0b1020'); sky.addColorStop(0.7, '#0e1426'); sky.addColorStop(1, '#070a14');
      g.fillStyle = sky; g.fillRect(0, 0, w, h);
      /* the city out of focus: soft discs of light */
      const cols = ['255,170,90', '110,170,255', '255,110,140', '150,255,200', '255,235,150'];
      for (let i = 0; i < 70; i++) {
        const r = 14 + R() * 46, x = R() * w, y = h * (0.35 + R() * 0.6);
        const c = cols[Math.floor(R() * cols.length)];
        const rg = g.createRadialGradient(x, y, 0, x, y, r);
        rg.addColorStop(0, `rgba(${c},${0.28 + R() * 0.3})`); rg.addColorStop(0.7, `rgba(${c},.12)`); rg.addColorStop(1, `rgba(${c},0)`);
        g.fillStyle = rg; g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill();
      }
      /* the pane: a faint sheen */
      const sh = g.createLinearGradient(0, 0, w, h);
      sh.addColorStop(0, 'rgba(255,255,255,.05)'); sh.addColorStop(0.5, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(255,255,255,.03)');
      g.fillStyle = sh; g.fillRect(0, 0, w, h);
      /* beads that stay where they are */
      S.beads = Array.from({ length: Math.round(w * h / 9000) }, () => ({ x: R() * w, y: R() * h, r: 1 + R() * 2.4 }));
      S.drops = S.drops || [];
    },
    step(S, dt) {
      const want = Math.round(S.w * S.h / 60000);
      if (S.drops.length < want && Math.random() < dt * 6) S.drops.push({ x: rnd(0, S.w), y: rnd(-10, S.h * 0.5), r: rnd(2.5, 6), v: 0, wait: rnd(0.2, 3), trail: [] });
      for (const d of S.drops) {
        d.wait -= dt;
        if (d.wait > 0) continue;
        d.v = Math.min(260, d.v + dt * rnd(40, 220) * (d.r / 4));
        if (Math.random() < dt * 1.2) d.wait = rnd(0.1, 0.8), d.v *= 0.2;
        d.y += d.v * dt; d.x += Math.sin(d.y * 0.04) * dt * 6;
        d.trail.push([d.x, d.y]); if (d.trail.length > 14) d.trail.shift();
      }
      S.drops = S.drops.filter(d => d.y < S.h + 20);
    },
    draw(g, S) {
      g.drawImage(S.back, 0, 0, S.w, S.h);
      g.fillStyle = 'rgba(210,225,255,.16)';
      for (const b of S.beads) { g.beginPath(); g.arc(b.x, b.y, b.r, 0, 6.283); g.fill(); }
      for (const d of S.drops) {
        g.strokeStyle = 'rgba(200,220,255,.16)'; g.lineWidth = d.r * 0.5; g.lineCap = 'round';
        if (d.trail.length > 1) { g.beginPath(); g.moveTo(d.trail[0][0], d.trail[0][1]); for (const p of d.trail) g.lineTo(p[0], p[1]); g.stroke(); }
        g.fillStyle = 'rgba(225,238,255,.34)'; g.beginPath(); g.ellipse(d.x, d.y, d.r * 0.8, d.r * 1.1, 0, 0, 6.283); g.fill();
        g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.arc(d.x - d.r * 0.25, d.y - d.r * 0.35, d.r * 0.28, 0, 6.283); g.fill();
      }
    },
    still(S) { for (let i = 0; i < Math.round(S.w * S.h / 80000); i++) S.drops.push({ x: rnd(0, S.w), y: rnd(0, S.h), r: rnd(2.5, 6), v: 0, wait: 0, trail: Array.from({ length: 8 }, (_, k) => [0, 0]) }); S.drops.forEach(d => { d.trail = d.trail.map((_, k) => [d.x, d.y - (8 - k) * d.r * 0.9]); }); },
  },

  fireflies: {
    build(S) {
      const { w, h, back } = S, g = back.getContext('2d'), R = seeded(23);
      const sky = g.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#08150f'); sky.addColorStop(0.55, '#0a1d13'); sky.addColorStop(1, '#030b07');
      g.fillStyle = sky; g.fillRect(0, 0, w, h);
      /* three layers of trees, far to near, each darker */
      [['#0b2216', 0.52, 0.16], ['#081a11', 0.62, 0.22], ['#04100a', 0.74, 0.3]].forEach(([col, base, tall], layer) => {
        g.fillStyle = col;
        const n = 7 + layer * 3;
        for (let i = 0; i < n; i++) {
          const x = (i + R() * 0.6) * (w / n), th = h * (tall + R() * 0.18), tw = w / n * (0.5 + R() * 0.4);
          g.beginPath(); g.moveTo(x, h * base + th * 0.2);
          for (let k = 0; k < 5; k++) { const yy = h * base - th + k * th * 0.28; g.lineTo(x - tw * (0.2 + k * 0.16), yy + th * 0.1); g.lineTo(x - tw * (0.08 + k * 0.1), yy); }
          g.lineTo(x, h * base - th - 8);
          for (let k = 4; k >= 0; k--) { const yy = h * base - th + k * th * 0.28; g.lineTo(x + tw * (0.08 + k * 0.1), yy); g.lineTo(x + tw * (0.2 + k * 0.16), yy + th * 0.1); }
          g.lineTo(x, h * base + th * 0.2); g.fill();
        }
        g.fillRect(0, h * base, w, h);
      });
      /* a moon glow */
      const mg = g.createRadialGradient(w * 0.78, h * 0.18, 0, w * 0.78, h * 0.18, h * 0.35);
      mg.addColorStop(0, 'rgba(200,255,230,.16)'); mg.addColorStop(1, 'rgba(200,255,230,0)');
      g.fillStyle = mg; g.fillRect(0, 0, w, h);
      S.flies = S.flies || Array.from({ length: Math.round(Math.max(18, Math.min(60, w * h / 22000))) }, () => ({
        x: rnd(0, w), y: rnd(h * 0.35, h * 0.95), a: rnd(0, 6.283), sp: rnd(8, 26), turn: rnd(-1, 1), ph: rnd(0, 6.283), hz: rnd(0.3, 0.9),
      }));
    },
    step(S, dt) {
      for (const f of S.flies) {
        f.a += (Math.sin(f.ph + f.a * 0.3) * 0.9 + f.turn * 0.3) * dt;
        f.x += Math.cos(f.a) * f.sp * dt; f.y += Math.sin(f.a) * f.sp * dt * 0.6; f.ph += dt * f.hz * 6.283;
        if (f.x < -20) f.x = S.w + 20; if (f.x > S.w + 20) f.x = -20;
        if (f.y < S.h * 0.3) f.a = Math.abs(f.a) % 3; if (f.y > S.h) f.a = -Math.abs(f.a);
      }
    },
    draw(g, S) {
      g.drawImage(S.back, 0, 0, S.w, S.h);
      g.globalCompositeOperation = 'lighter';
      for (const f of S.flies) {
        const k = Math.max(0, Math.sin(f.ph)) ** 2;
        const r = 14 + k * 14, rg = g.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
        rg.addColorStop(0, `rgba(235,255,140,${0.15 + k * 0.7})`); rg.addColorStop(1, 'rgba(235,255,140,0)');
        g.fillStyle = rg; g.beginPath(); g.arc(f.x, f.y, r, 0, 6.283); g.fill();
        g.fillStyle = `rgba(255,255,210,${0.3 + k * 0.7})`; g.beginPath(); g.arc(f.x, f.y, 1.6, 0, 6.283); g.fill();
      }
      g.globalCompositeOperation = 'source-over';
    },
    still(S) { S.flies.forEach((f, i) => { f.ph = 1.2 + (i % 5) * 0.5; }); },
  },

  city: {
    build(S) {
      const { w, h, back } = S, g = back.getContext('2d'), R = seeded(37);
      const sky = g.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#080c26'); sky.addColorStop(0.5, '#1a1c45'); sky.addColorStop(0.78, '#40295a'); sky.addColorStop(1, '#1b1430');
      g.fillStyle = sky; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 120; i++) { g.fillStyle = `rgba(255,255,255,${0.2 + R() * 0.6})`; g.fillRect(R() * w, R() * h * 0.5, 1.2, 1.2); }
      g.fillStyle = 'rgba(255,246,214,.9)'; g.beginPath(); g.arc(w * 0.82, h * 0.16, Math.min(w, h) * 0.035, 0, 6.283); g.fill();
      const mg = g.createRadialGradient(w * 0.82, h * 0.16, 0, w * 0.82, h * 0.16, h * 0.2);
      mg.addColorStop(0, 'rgba(255,246,214,.18)'); mg.addColorStop(1, 'rgba(255,246,214,0)');
      g.fillStyle = mg; g.fillRect(0, 0, w, h);
      /* two rows of buildings; the windows are kept so they can flicker */
      S.wins = [];
      const road = h * 0.9;
      [['#10122c', 0.3, 0.12], ['#0a0b1c', 0.2, 0.2]].forEach(([col, tall, wid], row) => {
        let x = -10;
        while (x < w) {
          const bw = w * (wid * (0.5 + R() * 0.7)) / 3, bh = h * (tall * (0.4 + R() * 0.9)) + h * (row ? 0 : 0.1);
          g.fillStyle = col; g.fillRect(x, road - bh, bw, bh + h);
          if (row === 0 && bh > h * 0.28) { g.fillRect(x + bw * 0.45, road - bh - 14, 2, 14); }
          if (row === 1) for (let wy = road - bh + 8; wy < road - 10; wy += 11) for (let wx = x + 5; wx < x + bw - 6; wx += 9) S.wins.push({ x: wx, y: wy, on: R() < 0.45, hue: R() < 0.8 ? '255,214,120' : '150,200,255', t: R() * 20 });
          x += bw + 2 + R() * 6;
        }
      });
      g.fillStyle = '#05060f'; g.fillRect(0, road, w, h - road);
      g.fillStyle = 'rgba(255,214,120,.14)'; g.fillRect(0, road, w, 2);
      S.cars = S.cars || Array.from({ length: 5 }, (_, i) => ({ x: rnd(0, w), dir: i % 2 ? 1 : -1, v: rnd(40, 110), lane: i % 2 ? 0.55 : 0.8 }));
      S.road = road;
    },
    step(S, dt) {
      for (const win of S.wins) { win.t -= dt; if (win.t < 0) { win.on = Math.random() < 0.5; win.t = rnd(4, 24); } }
      for (const c of S.cars) { c.x += c.dir * c.v * dt; if (c.x > S.w + 30) c.x = -30; if (c.x < -30) c.x = S.w + 30; }
    },
    draw(g, S) {
      g.drawImage(S.back, 0, 0, S.w, S.h);
      for (const win of S.wins) { if (!win.on) continue; g.fillStyle = `rgba(${win.hue},.75)`; g.fillRect(win.x, win.y, 4, 5); }
      g.globalCompositeOperation = 'lighter';
      for (const c of S.cars) {
        const y = S.road + (S.h - S.road) * c.lane, col = c.dir > 0 ? '255,250,210' : '255,70,60';
        const rg = g.createRadialGradient(c.x, y, 0, c.x, y, 16);
        rg.addColorStop(0, `rgba(${col},.8)`); rg.addColorStop(1, `rgba(${col},0)`);
        g.fillStyle = rg; g.beginPath(); g.arc(c.x, y, 16, 0, 6.283); g.fill();
        g.fillStyle = `rgba(${col},.9)`; g.fillRect(c.x - 2, y - 1, 4, 2);
      }
      g.globalCompositeOperation = 'source-over';
    },
    still() {},
  },
};

function setup(cv, id, S) {
  const sc = SCENE[id] || SCENE.rain;
  const dpr = Math.min(1.5, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
  S.w = Math.max(1, cv.clientWidth || (typeof innerWidth === 'number' ? innerWidth : 1280));
  S.h = Math.max(1, cv.clientHeight || (typeof innerHeight === 'number' ? innerHeight : 720));
  cv.width = Math.round(S.w * dpr); cv.height = Math.round(S.h * dpr);
  S.dpr = dpr;
  S.back = document.createElement('canvas');
  S.back.width = Math.round(S.w * dpr); S.back.height = Math.round(S.h * dpr);
  S.back.getContext('2d').scale(dpr, dpr);
  sc.build(S);
  /* the background canvas was drawn in CSS pixels; draw() scales it by dpr itself */
}

function frame(cv, id, S) {
  const g = cv.getContext('2d');
  g.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
  g.clearRect(0, 0, S.w, S.h);
  (SCENE[id] || SCENE.rain).draw(g, S);
}

/** One still frame onto a canvas that is on the page. */
export function paint(cv, id = 'rain') {
  const S = { drops: [] };
  setup(cv, id, S);
  (SCENE[id] || SCENE.rain).still?.(S);
  frame(cv, id, S);
  return S;
}

/** The wallpaper layer: <div.wp__live data-scene> holding the canvas. */
export function layer(h, base, id = 'rain') {
  const sceneId = SCENES[id] ? id : 'rain';
  const cv = document.createElement('canvas');
  cv.setAttribute('aria-hidden', 'true');
  cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
  const el = h('div.wp__live', { dataset: { scene: sceneId }, 'aria-hidden': 'true', style: { ...base, overflow: 'hidden' } });
  el.appendChild(cv);

  const S = { drops: [] };
  let raf = 0, last = 0, sized = '', moving = false;
  const motion = () => !reducedMotion();
  const running = () => el.isConnected && !document.hidden && document.documentElement.dataset.gamemode !== 'on'
    && !el.closest('.wp')?.classList.contains('wp--still');
  const fit = () => {
    const key = `${cv.clientWidth}x${cv.clientHeight}`;
    if (key === sized || !cv.clientWidth) return false;
    sized = key; setup(cv, sceneId, S);
    if (!motion()) { (SCENE[sceneId].still || (() => {}))(S); }
    return true;
  };
  const tick = now => {
    raf = 0;
    if (!el.isConnected) { stop(); return; }
    if (!running() || !motion()) { moving = false; return; }
    fit();
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0; last = now;
    (SCENE[sceneId].step)(S, dt);
    frame(cv, sceneId, S);
    raf = requestAnimationFrame(tick);
  };
  const go = () => {
    if (!el.isConnected) return;
    if (fit() || !S.back) { /* sized now */ }
    if (!motion()) { frame(cv, sceneId, S); return; }        /* one still frame, no loop */
    if (!raf && running()) { last = 0; moving = true; raf = requestAnimationFrame(tick); }
  };
  function stop() { cancelAnimationFrame(raf); raf = 0; moving = false; ro?.disconnect(); mq?.removeEventListener?.('change', onMq); document.removeEventListener('visibilitychange', go); }
  const onMq = () => { sized = ''; go(); };
  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  mq?.addEventListener?.('change', onMq);
  document.addEventListener('visibilitychange', go);
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { sized = ''; go(); }) : null;
  ro?.observe(el);
  /* the layer is built before it is attached: wait for the page */
  const arm = () => { if (el.isConnected) go(); else if (!el.dataset.dead) requestAnimationFrame(arm); };
  requestAnimationFrame(arm);
  /* a slow look for the things that send no event: Game Mode, the motion switch, the body class */
  const poll = setInterval(() => { if (!el.isConnected) { clearInterval(poll); stop(); return; } if (!moving) go(); }, 1500);
  el.__live = { get moving() { return moving; }, get scene() { return sceneId; } };
  return el;
}

export default { SCENES, IDS, layer, paint, reducedMotion };
