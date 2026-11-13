/* ============================================================
   forge/kit.js — the little game kit every Forge template runs on.

   forgeKit is never called in StaticOS's own page. Its SOURCE is
   copied into each template's game file (Function.prototype
   .toString), next to the game's own function, so a template is
   still one standalone HTML document: it runs in Forge's sandbox,
   in Studio, and as an exported .html in any browser. Because it
   is copied as text, forgeKit (and every game function) must not
   use anything from this module's scope, and must not contain the
   characters "</" + "script".

   What a game gets (K):
     size      K.W, K.H (CSS px), K.fit(vw, vh) -> { s, ox, oy } to
               letterbox a virtual area
     state     'start' | 'play' | 'pause' | 'over'; K.over(msg),
               K.win(msg); K.score, K.add(n, x, y), K.best (this
               session only — the sandbox has no storage)
     keys      K.held(...codes), K.hit(...codes) (pressed this
               frame), K.ax(), K.ay() (arrows / WASD, -1..1)
     pointers  K.ptrs (Map id -> {x, y, x0, y0, t0, type, used}),
               K.primary(), K.stick(r) (drag vector), K.mouse,
               K.touch (true once a finger was seen); game hooks
               down(p), move(p), up(p, tap)
     effects   K.burst(), K.float(), K.shake(), K.flash(), K.fx(g)
     sound     K.sfx(name), K.tone(f0, f1, secs, type, vol) — beeps made in
               code (WebAudio), M mutes
     helpers   K.rnd, K.ri, K.pick, K.clamp, K.lerp, K.dist, K.rr
               (rounded-rect path), K.txt, K.pill
   A game is function game(K, P) returning { title, tagline,
   controls: [lines], accent, bg, reset(), update(dt), draw(g),
   hud(g)?, idle(dt)?, resize()?, info()? }. P is the settings
   object from the document's #forge-params JSON.

   The kit draws the start, pause and game-over screens, so every
   template starts with Space / Enter / a tap, pauses with P or Esc
   (and when the game loses focus), restarts with Space / R / a tap.
   window.forgeGame exposes the state, score and game.info() for
   Forge's tests (read-only).
   ============================================================ */
export function forgeKit(make) {
  'use strict';
  const P = {};
  try {
    const raw = JSON.parse(document.getElementById('forge-params').textContent);
    for (const p of raw.params || []) P[p.k] = p.value;
  } catch (e) { /* no settings block: the game's own defaults apply */ }

  const cv = document.getElementById('c') || document.body.appendChild(document.createElement('canvas'));
  const g = cv.getContext('2d');
  const K = {
    W: 0, H: 0, dpr: 1, t: 0, state: 'start', score: 0, best: 0, newBest: false,
    ptrs: new Map(), touch: false, mouse: null, muted: P.sound === false,
    msg: '', won: false, overAt: 0, P,
  };
  const keys = Object.create(null);
  let hits = Object.create(null);
  const parts = [];
  const floats = [];
  let shakeAmt = 0;
  let flashA = 0;
  let flashC = '#fff';
  let note = null;               /* a short notice in screen space (mute) */
  let booted = false;

  /* ---------- helpers ---------- */
  K.rnd = (a, b) => a + Math.random() * (b - a);
  K.ri = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
  K.pick = arr => arr[Math.floor(Math.random() * arr.length)];
  K.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  K.lerp = (a, b, t) => a + (b - a) * t;
  K.dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
  K.num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  K.font = (size, weight) => (weight || 700) + ' ' + Math.round(size) + 'px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
  K.rr = (c, x, y, w, h, r) => {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  };
  K.txt = (c, s, x, y, size, color, align, weight) => {
    c.font = K.font(size, weight);
    c.textAlign = align || 'center';
    c.textBaseline = 'middle';
    c.fillStyle = color || '#fff';
    c.fillText(s, x, y);
  };
  /* a HUD chip: rounded dark pill with text; returns its width */
  K.pill = (c, s, x, y, color, align) => {
    c.font = K.font(14, 700);
    const w = c.measureText(s).width + 22;
    const left = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    c.fillStyle = 'rgba(6,8,16,.55)';
    K.rr(c, left, y, w, 28, 14);
    c.fill();
    K.txt(c, s, left + w / 2, y + 14.5, 14, color || '#fff', 'center', 700);
    return w;
  };
  K.fit = (vw, vh) => {
    const s = Math.min(K.W / vw, K.H / vh);
    return { s, ox: (K.W - vw * s) / 2, oy: (K.H - vh * s) / 2 };
  };

  /* ---------- input ---------- */
  K.held = (...codes) => codes.some(c => keys[c]);
  K.hit = (...codes) => codes.some(c => hits[c]);
  K.ax = () => (K.held('ArrowRight', 'KeyD') ? 1 : 0) - (K.held('ArrowLeft', 'KeyA') ? 1 : 0);
  K.ay = () => (K.held('ArrowDown', 'KeyS') ? 1 : 0) - (K.held('ArrowUp', 'KeyW') ? 1 : 0);
  K.primary = () => { for (const p of K.ptrs.values()) if (!p.used) return p; return null; };
  /* the drag of the first finger (or held mouse button) as a vector of length <= 1 */
  K.stick = (r) => {
    const p = K.primary();
    if (!p) return null;
    const R = r || 60;
    let dx = p.x - p.x0, dy = p.y - p.y0;
    const m = Math.hypot(dx, dy);
    if (m > R) { p.x0 = p.x - dx / m * R; p.y0 = p.y - dy / m * R; dx = dx / m * R; dy = dy / m * R; }
    const mag = Math.min(1, m / R);
    return { x: dx / R, y: dy / R, mag, p };
  };
  K.drawStick = (c, r) => {
    const p = K.primary();
    if (!p || p.type === 'mouse') return;
    const R = r || 60;
    c.save();
    c.globalAlpha = 0.35;
    c.strokeStyle = '#fff';
    c.lineWidth = 2;
    c.beginPath(); c.arc(p.x0, p.y0, R, 0, 7); c.stroke();
    c.globalAlpha = 0.5;
    c.fillStyle = '#fff';
    c.beginPath(); c.arc(p.x, p.y, 18, 0, 7); c.fill();
    c.restore();
  };

  /* ---------- sound: short tones made in code ---------- */
  let ac = null;
  let noise = null;
  function audio() {
    if (!ac) {
      try { const A = window.AudioContext || window.webkitAudioContext; ac = A ? new A() : null; } catch (e) { ac = null; }
    }
    if (ac && ac.state === 'suspended') ac.resume().catch(() => {});
    return ac;
  }
  /* name: [type, from Hz, to Hz, seconds, volume] — 'noise' is a filtered hiss */
  const SFX = {
    blip: ['square', 660, 880, 0.06, 0.05], pick: ['triangle', 740, 1480, 0.1, 0.09],
    coin: ['square', 988, 1319, 0.12, 0.05], shoot: ['square', 880, 220, 0.09, 0.04],
    hit: ['triangle', 320, 160, 0.08, 0.1], jump: ['square', 300, 620, 0.12, 0.04],
    hurt: ['sawtooth', 300, 90, 0.25, 0.07], power: ['triangle', 400, 1200, 0.3, 0.09],
    drop: ['triangle', 220, 110, 0.12, 0.1], perfect: ['sine', 880, 1760, 0.18, 0.1],
    lose: ['sawtooth', 330, 55, 0.7, 0.07], win: ['triangle', 523, 1047, 0.5, 0.1],
    boom: ['noise', 900, 60, 0.5, 0.35], thud: ['noise', 400, 80, 0.18, 0.25],
  };
  K.sfx = (name) => {
    if (K.muted) return;
    const a = ac;   /* only after the player has pressed something (autoplay rules) */
    const s = SFX[name];
    if (!a || !s || a.state !== 'running') return;
    try {
      const t = a.currentTime;
      const gain = a.createGain();
      gain.gain.setValueAtTime(s[4], t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + s[3]);
      gain.connect(a.destination);
      if (s[0] === 'noise') {
        if (!noise) {
          noise = a.createBuffer(1, a.sampleRate, a.sampleRate);
          const d = noise.getChannelData(0);
          for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        }
        const src = a.createBufferSource();
        src.buffer = noise;
        const f = a.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.setValueAtTime(s[1], t);
        f.frequency.exponentialRampToValueAtTime(s[2], t + s[3]);
        src.connect(f); f.connect(gain);
        src.start(t); src.stop(t + s[3]);
      } else {
        const o = a.createOscillator();
        o.type = s[0];
        o.frequency.setValueAtTime(s[1], t);
        o.frequency.exponentialRampToValueAtTime(s[2], t + s[3]);
        o.connect(gain);
        o.start(t); o.stop(t + s[3] + 0.02);
      }
    } catch (e) { /* sound is a nicety */ }
  };

  /* one tone of your own: K.tone(fromHz, toHz, seconds, type?, volume?) */
  K.tone = (f0, f1, sec, type, vol) => {
    if (K.muted) return;
    const a = ac;
    if (!a || a.state !== 'running') return;
    try {
      const t = a.currentTime;
      const gain = a.createGain();
      gain.gain.setValueAtTime(vol || 0.06, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + sec);
      gain.connect(a.destination);
      const o = a.createOscillator();
      o.type = type || 'triangle';
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, f1 || f0), t + sec);
      o.connect(gain);
      o.start(t); o.stop(t + sec + 0.02);
    } catch (e) { /* sound is a nicety */ }
  };

  /* ---------- effects ---------- */
  K.burst = (x, y, color, n, speed, o) => {
    o = o || {};
    for (let i = 0; i < (n || 12); i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (speed || 160) * (0.3 + Math.random() * 0.7);
      parts.push({ x, y, vx: Math.cos(a) * v + (o.vx || 0), vy: Math.sin(a) * v + (o.vy || 0), life: (o.life || 0.6) * (0.6 + Math.random() * 0.6),
        max: o.life || 0.6, size: (o.size || 3) * (0.6 + Math.random() * 0.8), color: Array.isArray(color) ? K.pick(color) : color, grav: o.grav || 0, drag: o.drag == null ? 2 : o.drag });
    }
    if (parts.length > 900) parts.splice(0, parts.length - 900);
  };
  K.float = (x, y, text, color, size) => { floats.push({ x, y, text, color: color || '#fff', size: size || 18, life: 0.9 }); };
  K.shake = s => { shakeAmt = Math.max(shakeAmt, s || 6); };
  K.flash = (color, a) => { flashC = color || '#fff'; flashA = a == null ? 0.35 : a; };
  K.fx = c => {
    for (const p of parts) {
      c.globalAlpha = Math.max(0, p.life / p.max);
      c.fillStyle = p.color;
      c.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    c.globalAlpha = 1;
    for (const f of floats) {
      c.globalAlpha = Math.min(1, f.life * 2);
      K.txt(c, f.text, f.x, f.y, f.size, f.color, 'center', 800);
    }
    c.globalAlpha = 1;
  };
  K.clearFx = () => { parts.length = 0; floats.length = 0; };
  function stepFx(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      p.vx -= p.vx * p.drag * dt;
      p.vy -= p.vy * p.drag * dt;
      p.vy += p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i];
      f.life -= dt;
      f.y -= 40 * dt;
      if (f.life <= 0) floats.splice(i, 1);
    }
    shakeAmt = Math.max(0, shakeAmt - dt * 40);
    flashA = Math.max(0, flashA - dt * 1.8);
  }

  /* ---------- score and state ---------- */
  K.add = (n, x, y, color) => {
    K.score += n;
    if (x != null) K.float(x, y, (n > 0 ? '+' : '') + n, color || '#fde68a');
  };
  function finish(msg, won) {
    if (K.state !== 'play') return;
    K.state = 'over';
    K.msg = msg || '';
    K.won = !!won;
    K.overAt = K.t;
    K.newBest = K.score > K.best;
    K.best = Math.max(K.best, K.score);
    K.sfx(won ? 'win' : 'lose');
  }
  K.over = msg => finish(msg, false);
  K.win = msg => finish(msg, true);

  /* K.accent is the accent setting if there is one; read it in draw(), not at make time */
  K.accent = /^#[0-9a-f]{6}$/i.test(P.accent || '') ? P.accent : '';
  const game = make(K, P);
  if (!K.accent) K.accent = game.accent || '#7dd3fc';
  const title = String(P.title || game.title || 'Game');
  const accent = K.accent;

  function begin() {
    K.score = 0;
    K.msg = '';
    K.won = false;
    K.clearFx();
    hits = Object.create(null);
    for (const p of K.ptrs.values()) p.used = true;
    game.reset();
    K.state = 'play';
    K.sfx('blip');
  }
  function pause(on) {
    if (on && K.state === 'play') { K.state = 'pause'; for (const k in keys) keys[k] = false; }
    else if (!on && K.state === 'pause') { K.state = 'play'; hits = Object.create(null); for (const p of K.ptrs.values()) p.used = true; }
  }
  const canRestart = () => K.t - K.overAt > 0.6;

  addEventListener('keydown', e => {
    audio();
    if (!booted) return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].indexOf(e.code) >= 0) e.preventDefault();
    if (!e.repeat) hits[e.code] = true;
    keys[e.code] = true;
    if (e.code === 'KeyM' && !e.repeat) { K.muted = !K.muted; note = { text: K.muted ? 'Sound off (M)' : 'Sound on (M)', t: 1.4 }; }
    if (e.repeat) return;
    const go = e.code === 'Space' || e.code === 'Enter';
    if (K.state === 'start' && go) begin();
    else if (K.state === 'over' && (go || e.code === 'KeyR') && canRestart()) begin();
    else if (K.state === 'play' && (e.code === 'KeyP' || e.code === 'Escape')) pause(true);
    else if (K.state === 'pause' && (go || e.code === 'KeyP' || e.code === 'Escape')) pause(false);
  });
  addEventListener('keyup', e => { keys[e.code] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; K.ptrs.clear(); pause(true); });

  const at = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  cv.addEventListener('pointerdown', e => {
    audio();
    e.preventDefault();
    if (!booted) return;
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
    if (e.pointerType === 'touch') K.touch = true;
    const q = at(e);
    const p = { id: e.pointerId, x: q.x, y: q.y, x0: q.x, y0: q.y, t0: K.t, type: e.pointerType, used: false };
    K.ptrs.set(e.pointerId, p);
    if (K.state === 'start' || K.state === 'pause') { if (K.state === 'start') begin(); else pause(false); return; }
    if (K.state === 'over') { if (canRestart()) begin(); return; }
    if (game.down) game.down(p);
  });
  cv.addEventListener('pointermove', e => {
    const q = at(e);
    if (e.pointerType === 'mouse') K.mouse = { x: q.x, y: q.y, t: K.t };
    const p = K.ptrs.get(e.pointerId);
    if (!p) return;
    p.x = q.x; p.y = q.y;
    if (game.move && !p.used && K.state === 'play') game.move(p);
  });
  const lift = e => {
    const p = K.ptrs.get(e.pointerId);
    if (!p) return;
    K.ptrs.delete(e.pointerId);
    const tap = K.t - p.t0 < 0.3 && Math.hypot(p.x - p.x0, p.y - p.y0) < 14;
    if (game.up && !p.used && K.state === 'play') game.up(p, tap);
  };
  cv.addEventListener('pointerup', lift);
  cv.addEventListener('pointercancel', lift);
  cv.addEventListener('contextmenu', e => e.preventDefault());

  function resize() {
    K.dpr = Math.min(2, window.devicePixelRatio || 1);
    K.W = Math.max(1, innerWidth);
    K.H = Math.max(1, innerHeight);
    cv.width = Math.round(K.W * K.dpr);
    cv.height = Math.round(K.H * K.dpr);
    if (booted && game.resize) game.resize(K.W, K.H);
  }
  addEventListener('resize', resize);
  /* A new frame can run its script before it has been laid out (its
     window is 0 x 0 then), and growing to its real size afterwards does
     not always send a resize event. So the game boots only once there is
     a real size, and the loop compares the size on every frame. */
  const sized = () => innerWidth > 1 && innerHeight > 1;
  function boot() {
    if (booted || !sized()) return booted;
    resize();
    game.reset();
    booted = true;
    return true;
  }
  boot();

  /* ---------- the kit's own screens ---------- */
  function veil(c, a) {
    c.fillStyle = 'rgba(4,5,12,' + a + ')';
    c.fillRect(0, 0, K.W, K.H);
  }
  function heading(c, s, y, size) {
    c.save();
    c.shadowColor = accent;
    c.shadowBlur = 24;
    let sz = size;
    c.font = K.font(sz, 900);
    while (sz > 18 && c.measureText(s).width > K.W - 40) { sz -= 2; c.font = K.font(sz, 900); }
    K.txt(c, s, K.W / 2, y, sz, accent, 'center', 900);
    c.restore();
  }
  function blink(c, s, y) {
    c.globalAlpha = 0.55 + 0.45 * Math.sin(K.t * 4);
    K.txt(c, s, K.W / 2, y, Math.min(18, K.W / 26), '#fff', 'center', 700);
    c.globalAlpha = 1;
  }
  const tapWord = () => (K.touch ? 'Tap' : 'Press Space or tap');
  function screens(c) {
    const big = K.clamp(Math.min(K.W, K.H * 1.6) * 0.085, 26, 64);
    if (K.state === 'start') {
      veil(c, 0.5);
      const lines = game.controls || [];
      const top = K.H / 2 - (lines.length * 22 + big + 70) / 2;
      heading(c, title, top + big / 2, big);
      if (game.tagline) K.txt(c, game.tagline, K.W / 2, top + big + 14, Math.min(16, K.W / 30), '#e5e7f0', 'center', 600);
      lines.forEach((l, i) => K.txt(c, l, K.W / 2, top + big + 46 + i * 22, Math.min(14, K.W / 34), 'rgba(226,232,255,.72)', 'center', 500));
      blink(c, tapWord() + ' to start', top + big + 66 + lines.length * 22);
      if (K.best > 0) K.txt(c, 'Best this session: ' + K.best, K.W / 2, K.H - 26, 13, 'rgba(226,232,255,.6)', 'center', 600);
    } else if (K.state === 'pause') {
      veil(c, 0.55);
      heading(c, 'Paused', K.H / 2 - 16, big * 0.8);
      blink(c, (K.touch ? 'Tap' : 'Press P or tap') + ' to carry on', K.H / 2 + big * 0.5);
    } else if (K.state === 'over') {
      const k = Math.min(1, (K.t - K.overAt) / 0.4);
      veil(c, 0.6 * k);
      c.globalAlpha = k;
      heading(c, K.msg || (K.won ? 'You win!' : 'Game over'), K.H / 2 - big * 0.9, big * 0.85);
      K.txt(c, 'Score ' + K.score, K.W / 2, K.H / 2 + 6, Math.min(26, K.W / 18), '#fff', 'center', 800);
      K.txt(c, K.newBest && K.score > 0 ? 'New best this session!' : 'Best this session: ' + K.best, K.W / 2, K.H / 2 + 38, 14, K.newBest && K.score > 0 ? accent : 'rgba(226,232,255,.7)', 'center', 700);
      c.globalAlpha = 1;
      if (canRestart()) blink(c, (K.touch ? 'Tap' : 'Press Space, R or tap') + ' to play again', K.H / 2 + 84);
    }
  }

  /* ---------- the loop ---------- */
  const seen = Object.create(null);
  function report(e) {
    const m = String(e && e.message || e);
    if (seen[m]) return;
    seen[m] = 1;
    setTimeout(() => { throw e; }, 0);   /* reaches the console (and Forge's) without stopping the loop */
  }
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (!boot()) return;
    if (Math.max(1, innerWidth) !== K.W || Math.max(1, innerHeight) !== K.H) resize();
    K.t += dt;
    try {
      if (K.state === 'play') game.update(dt);
      else if (game.idle) game.idle(dt);
    } catch (e) { report(e); }
    stepFx(dt);
    hits = Object.create(null);
    g.setTransform(K.dpr, 0, 0, K.dpr, 0, 0);
    g.globalAlpha = 1;
    g.fillStyle = game.bg || '#05060a';
    g.fillRect(0, 0, K.W, K.H);
    g.save();
    if (shakeAmt > 0) g.translate((Math.random() - 0.5) * shakeAmt, (Math.random() - 0.5) * shakeAmt);
    try { game.draw(g); } catch (e) { report(e); }
    g.restore();
    g.setTransform(K.dpr, 0, 0, K.dpr, 0, 0);
    g.globalAlpha = 1;
    if (flashA > 0) { g.globalAlpha = flashA; g.fillStyle = flashC; g.fillRect(0, 0, K.W, K.H); g.globalAlpha = 1; }
    try { if (game.hud && K.state !== 'start') game.hud(g); } catch (e) { report(e); }
    screens(g);
    if (note) {
      note.t -= dt;
      g.globalAlpha = Math.min(1, note.t * 3);
      K.pill(g, note.text, K.W / 2, K.H - 44, '#fff', 'center');
      g.globalAlpha = 1;
      if (note.t <= 0) note = null;
    }
  }
  requestAnimationFrame(frame);

  window.forgeGame = Object.freeze({
    get state() { return K.state; },
    get score() { return K.score; },
    info: () => (booted && game.info ? game.info() : null),
  });
  return K;
}
