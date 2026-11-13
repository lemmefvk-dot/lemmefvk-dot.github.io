/* ============================================================
   arcade/slicer.js — Fruit Slice for Static Arcade.

   Fruit is thrown up in arcs. Swipe through it to slice it in two.

   · Each fruit is worth 10. Slice two or more in one swipe for a
     combo: +10 for two, +30 for three, +60 for four, and so on.
   · A fruit that falls out of the bottom of the screen unsliced is
     a miss; three misses end the round.
   · Slice a bomb and the round is over at once. Let bombs fall.
   · The waves get bigger and a bit more crowded with bombs as the
     score climbs.

   Mouse or touch: press and drag to leave a blade trail.
   Keyboard: arrows move a slice cursor. Hold Space (or Enter) while
   moving it to cut as it goes; tap Space for a quick slash through
   it in the way it last moved.
   Reduced motion: no spray of juice or screen flash, and a shorter
   trail; everything else plays the same.
   Test hook (el.arcadeHook): inert unless called; see the end of mount().
   ============================================================ */
import { clamp, hsl, FONT, coarse, surface, ownsKey, sounder, looper, prompt } from './kit.js';

const FRUITS = [
  { name: 'apple',      skin: [356, 75, 48], flesh: [48, 70, 88], rind: [356, 80, 38] },
  { name: 'orange',     skin: [28, 95, 52],  flesh: [34, 100, 62], rind: [26, 95, 44] },
  { name: 'kiwi',       skin: [30, 40, 36],  flesh: [92, 70, 52], rind: [30, 40, 28] },
  { name: 'melon',      skin: [128, 50, 34], flesh: [350, 80, 62], rind: [120, 45, 24] },
  { name: 'lemon',      skin: [54, 95, 56],  flesh: [58, 90, 78], rind: [52, 90, 46] },
  { name: 'berry',      skin: [282, 55, 40], flesh: [300, 60, 56], rind: [282, 55, 28] },
];
const MAX_MISS = 3;
const COMBO_GAP = 0.5;

export default {
  mount(el, ctx) {
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    const S = {
      state: 'ready',                    /* ready | play | dying | over */
      paused: false, manual: false, auto: true,
      score: 0, misses: 0, sliced: 0, time: 0, nextId: 1,
      items: [], halves: [], parts: [], pops: [], queue: [], waveT: 0.6,
      trail: [], blade: false, last: null,
      combo: null, bombAt: null, dieT: 0, cursor: null, keys: new Set(), slash: null, face: [1, 0],
    };
    const sf = surface(el, 'Fruit Slice field', () => draw());
    S.cursor = { x: sf.w / 2, y: sf.h / 2 };
    ctx.onScore(0);

    const gravity = () => sf.h * 1.55;
    const radius = () => clamp(Math.min(sf.w, sf.h) * 0.075, 24, 48);

    /* ------------------------------ spawning ------------------------------ */
    function make(kind, type, x, y, vx, vy, hold = false) {
      const it = {
        id: S.nextId++, kind, type, x, y, vx, vy, r: radius(), hold,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 5, done: false,
      };
      S.items.push(it);
      return it;
    }
    function launch(kind) {
      const g = gravity(), r = radius();
      const x = sf.w * (0.14 + 0.72 * Math.random());
      const apex = sf.h * (0.5 + 0.38 * Math.random());
      const vy = -Math.sqrt(2 * g * apex);
      const vx = (sf.w / 2 - x) * (0.2 + 0.3 * Math.random());
      make(kind, Math.floor(Math.random() * FRUITS.length), x, sf.h + r, vx, vy);
      snd.blip(240, 0.08, 'sine', 0.4, 420);
    }
    function wave() {
      const lvl = S.score / 100;
      const n = clamp(1 + Math.floor(lvl * 1.2 + Math.random() * 2.2), 1, 6);
      const pBomb = Math.min(0.26, 0.09 + lvl * 0.02);
      let bombs = 0;
      for (let i = 0; i < n; i++) {
        const bomb = Math.random() < pBomb && bombs < (n >= 4 ? 2 : 1) && (n > 1 || Math.random() < 0.5);
        if (bomb) bombs++;
        S.queue.push({ t: i * 0.13, kind: bomb ? 'bomb' : 'fruit' });
      }
      S.waveT = Math.max(0.85, 1.9 - lvl * 0.12) + n * 0.1;
    }

    /* ------------------------------ slicing ------------------------------ */
    const segDist = (px, py, ax, ay, bx, by) => {
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      const t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
      return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    };
    function cutSegment(ax, ay, bx, by) {
      if (S.state !== 'play') return;
      S.face = [bx - ax || S.face[0], by - ay || S.face[1]];
      for (const it of S.items) {
        if (it.done) continue;
        if (segDist(it.x, it.y, ax, ay, bx, by) > it.r * 0.95) continue;
        if (it.kind === 'bomb') { explode(it); return; }
        sliceFruit(it, bx - ax, by - ay);
        if (S.state !== 'play') return;
      }
    }
    function sliceFruit(it, dx, dy) {
      it.done = true; S.sliced++;
      S.score += 10; ctx.onScore(S.score);
      const f = FRUITS[it.type], ang = Math.atan2(dy, dx);
      for (const s of [-1, 1]) {
        S.halves.push({
          type: it.type, x: it.x, y: it.y, r: it.r, rot: ang + (s < 0 ? Math.PI : 0),
          vx: it.vx * 0.5 + Math.cos(ang + s * Math.PI / 2) * 90 * (reduced ? 0.6 : 1), vy: it.vy * 0.5 + Math.sin(ang + s * Math.PI / 2) * 90,
          vr: s * (reduced ? 0.4 : 1.6 + Math.random() * 1.4), life: 1.4,
        });
      }
      if (!reduced) for (let i = 0; i < 12; i++) {
        const a = Math.random() * 6.28, v = 80 + Math.random() * 220;
        S.parts.push({ x: it.x, y: it.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.45 + Math.random() * 0.4, hue: f.flesh[0] });
      }
      S.pops.push({ text: '+10', x: it.x, y: it.y - it.r, t: 0.7, hue: f.flesh[0] });
      snd.blip(520 + Math.min(6, S.combo ? S.combo.n : 0) * 80, 0.07, 'triangle', 0.8, 900);
      /* combo bookkeeping: slices within half a second of each other while the blade is down */
      if (S.combo && S.time - S.combo.t <= COMBO_GAP) { S.combo.n++; S.combo.t = S.time; }
      else { finishCombo(); S.combo = { n: 1, t: S.time }; }
      S.combo.x = it.x; S.combo.y = it.y;
      if (S.combo.n >= 2) {
        const n = S.combo.n, bonus = 10 * n * (n - 1) / 2, prev = S.combo.paid || 0;
        S.score += bonus - prev; S.combo.paid = bonus;
        ctx.onScore(S.score);
        S.pops = S.pops.filter(p => !p.combo);
        S.pops.push({ text: `Combo x${n}  +${bonus}`, x: clamp(it.x, 90, sf.w - 90), y: it.y - it.r - 22, t: 1.1, hue: 48, combo: true });
        snd.blip(700 + n * 90, 0.12, 'square', 0.7, 1200 + n * 90);
      }
    }
    function finishCombo() { S.combo = null; }
    function explode(it) {
      it.done = true; S.bombAt = { x: it.x, y: it.y };
      S.state = 'dying'; S.dieT = 0; S.blade = false;
      if (!reduced) for (let i = 0; i < 30; i++) {
        const a = Math.random() * 6.28, v = 120 + Math.random() * 380;
        S.parts.push({ x: it.x, y: it.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 + Math.random() * 0.6, hue: 30 });
      }
      snd.blip(120, 0.6, 'sawtooth', 1, 30);
    }
    function miss(it) {
      S.misses++;
      S.pops.push({ text: '✕', x: clamp(it.x, 20, sf.w - 20), y: sf.h - 40, t: 0.8, hue: 0 });
      snd.blip(180, 0.15, 'triangle', 0.6, 90);
      if (S.misses >= MAX_MISS) { S.state = 'dying'; S.dieT = 0; S.bombAt = null; S.blade = false; }
    }
    function finish() {
      S.state = 'over';
      const why = S.bombAt ? 'Sliced a bomb' : `${MAX_MISS} misses`;
      ctx.onEnd({ score: S.score, won: false, detail: `${why} · ${S.sliced} fruit sliced` });
    }

    /* ------------------------------ loop ------------------------------ */
    function addTrail(x, y) { S.trail.push({ x, y, t: S.time }); }
    function update(dt) {
      S.time += dt;
      /* the keyboard cursor */
      if (S.state === 'play' || S.state === 'ready') {
        const sp = Math.max(420, sf.w * 0.85);
        let dx = (S.keys.has('ArrowRight') ? 1 : 0) - (S.keys.has('ArrowLeft') ? 1 : 0);
        let dy = (S.keys.has('ArrowDown') ? 1 : 0) - (S.keys.has('ArrowUp') ? 1 : 0);
        if (dx || dy) {
          const l = Math.hypot(dx, dy), ox = S.cursor.x, oy = S.cursor.y;
          S.cursor.x = clamp(ox + dx / l * sp * dt, 0, sf.w); S.cursor.y = clamp(oy + dy / l * sp * dt, 0, sf.h);
          S.face = [dx, dy];
          if (S.blade && S.state === 'play' && S.kb) { addTrail(S.cursor.x, S.cursor.y); cutSegment(ox, oy, S.cursor.x, S.cursor.y); }
        }
      }
      if (S.slash) {                                   /* a quick slash through the cursor */
        S.slash.t -= dt;
        const k = 1 - clamp(S.slash.t / 0.1, 0, 1), s = S.slash;
        const x = s.ax + (s.bx - s.ax) * k, y = s.ay + (s.by - s.ay) * k;
        addTrail(x, y); cutSegment(s.px, s.py, x, y); s.px = x; s.py = y;
        if (S.slash && S.slash.t <= 0) S.slash = null;
      }
      if (S.combo && S.time - S.combo.t > COMBO_GAP) finishCombo();
      const g = gravity();
      if (S.state === 'play') {
        if (S.auto) {
          S.waveT -= dt;
          if (S.waveT <= 0) wave();
        }
        for (const q of S.queue) q.t -= dt;
        for (const q of S.queue.filter(q => q.t <= 0)) launch(q.kind);
        S.queue = S.queue.filter(q => q.t > 0);
      }
      if (S.state === 'play' || S.state === 'dying') {
        for (const it of S.items) {
          if (it.hold) continue;
          it.vy += g * dt; it.x += it.vx * dt; it.y += it.vy * dt; it.rot += it.vr * dt;
          if (!it.done && it.vy > 0 && it.y - it.r > sf.h) {
            it.done = true;
            if (it.kind === 'fruit' && S.state === 'play') miss(it);
          }
        }
        S.items = S.items.filter(it => !it.done);
      }
      for (const h of S.halves) { h.vy += g * dt; h.x += h.vx * dt; h.y += h.vy * dt; h.rot += h.vr * dt; h.life -= dt; }
      S.halves = S.halves.filter(h => h.life > 0 && h.y - h.r < sf.h + 20);
      for (const p of S.parts) { p.vy += g * 0.4 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
      S.parts = S.parts.filter(p => p.life > 0);
      for (const p of S.pops) { p.t -= dt; if (!reduced) p.y -= dt * 30; }
      S.pops = S.pops.filter(p => p.t > 0);
      const horizon = reduced ? 0.12 : 0.28;
      S.trail = S.trail.filter(p => S.time - p.t < horizon);
      if (S.state === 'dying') { S.dieT += dt; if (S.dieT > (S.bombAt ? 0.9 : 0.6)) finish(); }
    }
    const loop = looper(dt => {
      if (!S.manual) update(dt);
      draw();
      if (S.state === 'over' && !S.halves.length && !S.parts.length) loop.stop();
    });

    /* ------------------------------ drawing ------------------------------ */
    function fruitBody(g, it) {
      const f = FRUITS[it.type], r = it.r;
      g.save(); g.translate(it.x, it.y); g.rotate(it.rot);
      g.fillStyle = hsl(...f.skin);
      g.beginPath();
      if (f.name === 'lemon') g.ellipse(0, 0, r * 1.1, r * 0.85, 0, 0, 7); else g.arc(0, 0, r, 0, 7);
      g.fill();
      g.fillStyle = hsl(f.skin[0], f.skin[1], Math.min(90, f.skin[2] + 22), 0.55); g.beginPath(); g.ellipse(-r * 0.3, -r * 0.35, r * 0.28, r * 0.16, -0.6, 0, 7); g.fill();
      if (f.name === 'melon') { g.strokeStyle = hsl(120, 50, 20, 0.7); g.lineWidth = 3; for (const k of [-0.5, 0, 0.5]) { g.beginPath(); g.ellipse(0, 0, r * (0.3 + Math.abs(k) * 0.3), r, 0, 0, 7); g.stroke(); } }
      if (f.name === 'kiwi') { g.fillStyle = hsl(30, 45, 46, 0.5); for (let i = 0; i < 9; i++) g.fillRect(Math.cos(i * 2.1) * r * 0.6, Math.sin(i * 1.7) * r * 0.6, 2, 2); }
      if (f.name === 'berry') { g.fillStyle = hsl(290, 60, 55, 0.5); for (let i = 0; i < 7; i++) { g.beginPath(); g.arc(Math.cos(i * 2.4) * r * 0.5, Math.sin(i * 2.4) * r * 0.5, r * 0.26, 0, 7); g.fill(); } }
      g.strokeStyle = hsl(100, 45, 30); g.lineWidth = 3; g.lineCap = 'round';
      g.beginPath(); g.moveTo(0, -r * 0.9); g.lineTo(2, -r * 1.22); g.stroke();
      g.restore();
    }
    function bombBody(g, it) {
      const r = it.r;
      g.save(); g.translate(it.x, it.y); g.rotate(it.rot * 0.3);
      g.fillStyle = '#15171f'; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
      g.strokeStyle = '#3a3f55'; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, r - 1, 0.4, 2.4); g.stroke();
      g.fillStyle = '#2a2e3f'; g.fillRect(-r * 0.25, -r * 1.15, r * 0.5, r * 0.3);
      g.strokeStyle = hsl(35, 50, 70); g.lineWidth = 2.5; g.beginPath(); g.moveTo(0, -r * 1.15); g.quadraticCurveTo(r * 0.3, -r * 1.5, r * 0.6, -r * 1.35); g.stroke();
      const spark = reduced ? 1 : 0.6 + 0.4 * Math.sin(S.time * 30 + it.id);
      g.fillStyle = hsl(40, 100, 60, spark); g.beginPath(); g.arc(r * 0.62, -r * 1.37, 4 + spark * 2, 0, 7); g.fill();
      g.fillStyle = '#ff5a4d'; g.font = `800 ${Math.round(r * 0.8)}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('✕', 0, 2);
      g.restore();
    }
    function halfBody(g, h) {
      const f = FRUITS[h.type], r = h.r;
      g.save(); g.translate(h.x, h.y); g.rotate(h.rot);
      g.globalAlpha = clamp(h.life * 2, 0, 1);
      g.fillStyle = hsl(...f.rind); g.beginPath(); g.arc(0, 0, r, 0, Math.PI); g.closePath(); g.fill();
      g.fillStyle = hsl(...f.flesh); g.beginPath(); g.arc(0, 0, r * 0.84, 0, Math.PI); g.closePath(); g.fill();
      g.fillStyle = hsl(f.flesh[0], f.flesh[1], Math.min(95, f.flesh[2] + 14), 0.7); g.beginPath(); g.arc(0, 0, r * 0.3, 0, Math.PI); g.fill();
      g.restore();
    }
    function draw() {
      const g = sf.g;
      sf.begin();
      const W = sf.w, H = sf.h;
      const bg = g.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#1a1230'); bg.addColorStop(1, '#2d1a2f');
      g.fillStyle = bg; g.fillRect(0, 0, W, H);
      g.fillStyle = 'rgba(255,255,255,.035)';
      for (let i = 0; i < 9; i++) g.fillRect(0, H * 0.12 + i * H * 0.1, W, 2);
      /* wooden board feel along the bottom */
      g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, H - 8, W, 8);

      for (const h of S.halves) halfBody(g, h);
      for (const it of S.items) { if (it.done) continue; (it.kind === 'bomb' ? bombBody : fruitBody)(g, it); }
      for (const p of S.parts) { g.fillStyle = hsl(p.hue, 90, 60, clamp(p.life * 2.2, 0, 1)); g.beginPath(); g.arc(p.x, p.y, 3, 0, 7); g.fill(); }

      /* the blade trail */
      if (S.trail.length > 1) {
        g.lineCap = 'round'; g.lineJoin = 'round';
        const horizon = reduced ? 0.12 : 0.28;
        for (let i = 1; i < S.trail.length; i++) {
          const a = S.trail[i - 1], b = S.trail[i], age = clamp(1 - (S.time - b.t) / horizon, 0, 1);
          g.strokeStyle = `rgba(210,245,255,${0.9 * age})`; g.lineWidth = 2 + 7 * age;
          g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
        }
      }
      /* the keyboard's slice cursor */
      if (S.cursor && (S.kb || S.keys.size)) {
        const c = S.cursor;
        g.strokeStyle = S.blade ? hsl(190, 100, 80) : 'rgba(255,255,255,.75)'; g.lineWidth = 2;
        g.beginPath(); g.arc(c.x, c.y, 13, 0, 7); g.moveTo(c.x - 20, c.y); g.lineTo(c.x - 7, c.y); g.moveTo(c.x + 7, c.y); g.lineTo(c.x + 20, c.y);
        g.moveTo(c.x, c.y - 20); g.lineTo(c.x, c.y - 7); g.moveTo(c.x, c.y + 7); g.lineTo(c.x, c.y + 20); g.stroke();
      }
      g.font = `800 ${Math.round(clamp(W * 0.04, 15, 24))}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (const p of S.pops) { g.fillStyle = hsl(p.hue, 100, 78, clamp(p.t * 2, 0, 1)); g.fillText(p.text, p.x, p.y); }
      /* misses */
      for (let i = 0; i < MAX_MISS; i++) {
        g.strokeStyle = i < S.misses ? hsl(0, 85, 60) : 'rgba(255,255,255,.28)'; g.lineWidth = 4; g.lineCap = 'round';
        const x = W - 22 - i * 26, y = 22;
        g.beginPath(); g.moveTo(x - 7, y - 7); g.lineTo(x + 7, y + 7); g.moveTo(x + 7, y - 7); g.lineTo(x - 7, y + 7); g.stroke();
      }
      if (S.state === 'dying' && S.bombAt && !reduced) { g.fillStyle = `rgba(255,240,210,${Math.max(0, 0.55 - S.dieT)})`; g.fillRect(0, 0, W, H); }
      if (S.state === 'ready') prompt(g, sf, coarse() ? 'Swipe to slice' : 'Drag across the fruit to slice it', coarse() ? 'Skip the bombs. Three misses and you are out.' : 'Or use the arrows and Space. Skip the bombs. Three misses end it.', 330, H * 0.5);
    }

    /* ------------------------------ input ------------------------------ */
    const pos = e => { const r = sf.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    let ptr = null;
    const onDown = e => {
      if (S.paused || S.state === 'over' || S.state === 'dying') return;
      snd.wake();
      try { sf.cv.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
      ptr = { id: e.pointerId, ...pos(e) };
      S.blade = true; S.kb = false; S.trail = [];
      if (S.state === 'ready') { S.state = 'play'; S.waveT = 0.3; }
      addTrail(ptr.x, ptr.y);
      S.cursor = { x: ptr.x, y: ptr.y };
    };
    const onMove = e => {
      if (!ptr || e.pointerId !== ptr.id || S.paused) return;
      const pts = e.getCoalescedEvents?.() || [];
      for (const q of pts.length ? pts : [e]) {
        const p = pos(q);
        if (Math.hypot(p.x - ptr.x, p.y - ptr.y) < 1) continue;
        addTrail(p.x, p.y);
        cutSegment(ptr.x, ptr.y, p.x, p.y);
        ptr.x = p.x; ptr.y = p.y; S.cursor = { x: p.x, y: p.y };
      }
      if (!loop.on && S.state !== 'over') draw();
    };
    const onUp = e => {
      if (ptr && e.pointerId === ptr.id) { ptr = null; S.blade = false; }
    };
    const onKey = e => {
      if (!ownsKey(el, e)) return;
      if (S.paused || S.state === 'over' || S.state === 'dying') return;
      const k = e.key;
      const map = { a: 'ArrowLeft', d: 'ArrowRight', w: 'ArrowUp', s: 'ArrowDown' };
      const arrow = map[k.toLowerCase()] || (k.startsWith('Arrow') ? k : '');
      if (arrow) {
        e.preventDefault(); snd.wake();
        S.keys.add(arrow); S.kb = true;
        if (S.state === 'ready') { S.state = 'play'; S.waveT = 0.3; }
      } else if (k === ' ' || k === 'Enter') {
        e.preventDefault();
        if (e.repeat) return;
        snd.wake(); S.kb = true;
        if (S.state === 'ready') { S.state = 'play'; S.waveT = 0.3; }
        S.blade = true;
        /* a tap is a quick slash through the cursor in the way it last moved */
        const l = Math.hypot(S.face[0], S.face[1]) || 1, d = 70 * Math.max(1, radius() / 30);
        const ux = S.face[0] / l, uy = S.face[1] / l, c = S.cursor;
        S.slash = { ax: c.x - ux * d, ay: c.y - uy * d, bx: c.x + ux * d, by: c.y + uy * d, t: 0.1, px: c.x - ux * d, py: c.y - uy * d };
      } else return;
      if (!loop.on && S.state !== 'over') draw();
    };
    const onKeyUp = e => {
      const map = { a: 'ArrowLeft', d: 'ArrowRight', w: 'ArrowUp', s: 'ArrowDown' };
      const arrow = map[e.key.toLowerCase()] || (e.key.startsWith('Arrow') ? e.key : '');
      if (arrow) S.keys.delete(arrow);
      else if (e.key === ' ' || e.key === 'Enter') { if (S.kb) S.blade = false; }
    };
    const onBlur = () => { S.keys.clear(); if (S.kb) S.blade = false; };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    sf.cv.addEventListener('pointerdown', onDown);
    sf.cv.addEventListener('pointermove', onMove);
    sf.cv.addEventListener('pointerup', onUp);
    sf.cv.addEventListener('pointercancel', onUp);

    draw();
    loop.start();

    return {
      stop() {
        loop.stop();
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onBlur);
        sf.cv.removeEventListener('pointerdown', onDown);
        sf.cv.removeEventListener('pointermove', onMove);
        sf.cv.removeEventListener('pointerup', onUp);
        sf.cv.removeEventListener('pointercancel', onUp);
        snd.close();
        sf.destroy();
      },
      pause() { S.paused = true; S.blade = false; S.keys.clear(); ptr = null; loop.stop(); draw(); },
      resume() { S.paused = false; if (S.state !== 'over') loop.start(); },
      /* a read-only snapshot for automated play-tests; positions are in canvas pixels */
      peek: () => ({
        state: S.state, paused: S.paused, score: S.score, misses: S.misses, sliced: S.sliced, time: S.time, combo: S.combo ? S.combo.n : 0,
        cursor: { ...S.cursor }, w: sf.w, h: sf.h,
        items: S.items.filter(i => !i.done).map(i => ({ id: i.id, kind: i.kind, type: i.type, x: i.x, y: i.y, r: i.r })),
        halves: S.halves.length,
      }),
      /* test hook — nothing in the game calls it:
         manual(bool: stop the clock, step it by hand) · step(seconds) · auto(bool: waves on their own)
         place({ kind: 'fruit'|'bomb', type?, fx, fy, hold?: false, vy? }) hangs one in the air, still, at that fraction of the field
         (hold: false lets it fall, at vy px/s) · clear() */
      hook(cmd, arg) {
        let out = true;
        if (cmd === 'step') { for (let t = 0; t < arg; t += 1 / 60) update(1 / 60); }
        else if (cmd === 'manual') S.manual = !!arg;
        else if (cmd === 'auto') S.auto = !!arg;
        else if (cmd === 'place') out = make(arg.kind, arg.type ?? 0, sf.w * arg.fx, sf.h * arg.fy, 0, arg.vy || 0, arg.hold !== false).id;
        else if (cmd === 'clear') { S.items = []; S.queue = []; }
        draw();
        return out;
      },
    };
  },
};
