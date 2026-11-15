/* ============================================================
   arcade/skyhop.js — Sky Hop for Static Arcade.

   A little hopper bounces by itself; you only steer. Land on a cloud
   and it bounces you up. Some clouds drift sideways, some crumble the
   moment you land (and give no bounce), and some carry a spring that
   shoots you much higher. Leave one side of the screen and you come in
   on the other. The camera only ever climbs: fall below the bottom of
   the screen and the round is over. Score: height in metres (more is
   better).

   Keys: ← → (or A D) steer. Mouse / touch: hold the left or right half
   of the screen. Tilt: press T (or tap "Tilt" on a phone) — only if
   the device asks for and is granted permission.

   Spring combo: springs hit one after another, with no ordinary bounce
   between, launch harder each time — ×1.12, ×1.24, up to ×1.36 from the
   fourth — and the screen says which one it is. Any other landing ends
   the combo.

   Themes (ctx.settings.theme, Options; how it looks, not how it plays):
   Day (the blue sky as it always was), Sunset and Space.

   Physics: a fixed 1/120-second step. Only a falling hopper can land,
   and only when its feet pass down through a cloud's top between two
   steps while it is over the cloud, so it can't be caught from below.
   The highest bounce (700 px/s up, gravity 1400) climbs 175 px and the
   clouds are never more than 130 px apart, so every cloud is reachable.
   ============================================================ */
import { clamp, hsl, FONT, coarse, fitView, surface, ownsKey, sounder, looper, rr, prompt, rng, randomSeed } from './kit.js';

const VW = 400, VH = 640;
const G = 1400, BOUNCE = 700, SPRING = 1150, DT = 1 / 120;
const PW = 70, PH = 12, HALF = 15, MAX_VX = 300;
const px = 10;                                  /* pixels per metre */
const COMBO_STEP = 0.12, COMBO_MAX = 4;
/* the looks: sky gradient (hue, sat, light at the top and bottom, and how far it shifts with height), stars, cloud colours */
const THEMES = {
  day: { top: [225, 70, 18], bot: [200, 75, 55], shift: [-15, -12, -20, -35], star: '255,255,255', clouds: { normal: ['#ffffff', '#b9d4ee'], moving: ['#b9f0ff', '#58b8e0'], breaking: ['#d9b48a', '#8a6038'] } },
  sunset: { top: [265, 55, 22], bot: [22, 90, 62], shift: [-10, -10, -12, -30], star: '255,230,200', clouds: { normal: ['#fff1e3', '#f3a98a'], moving: ['#ffd9f0', '#d97bb5'], breaking: ['#c99a7a', '#7a4a32'] } },
  space: { top: [240, 60, 6], bot: [255, 55, 18], shift: [0, 0, 0, -8], star: '220,230,255', clouds: { normal: ['#c9d6ff', '#7d8fd6'], moving: ['#9ff5e6', '#3fb8a6'], breaking: ['#b9a0ff', '#5a3fa8'] } },
};

export default {
  mount(el, ctx) {
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    let rand = rng(Number.isInteger(ctx.seed) ? ctx.seed >>> 0 : randomSeed());   /* ctx.seed: the shell's, so a seed is a sky of clouds */
    let dead = false;
    const S = {
      state: 'ready',                      /* ready | play | over */
      paused: false, frozen: false, time: 0,
      x: VW / 2, y: 60, vx: 0, vy: 0, face: 1,                  /* y is height above the start: up is positive */
      cam: 0, top: 0, score: 0,
      plats: [], bounces: 0, breaks: 0, springs: 0, combo: 0, maxCombo: 0, comboT: -9,
      keyL: false, keyR: false, ptrL: new Set(), ptrR: new Set(), tilt: null, tiltOn: false,
      parts: [], over: false, lastTop: 0,
    };
    const sf = surface(el, 'Sky Hop', () => draw());
    let V = fitView(sf, VW, VH, 4);
    /* the look picked in Options (read live, so a change shows when the round resumes) */
    const theme = () => THEMES[ctx.settings?.theme] || THEMES.day;

    /* ------------------------------ the clouds ------------------------------ */
    let prevKind = 'normal';
    function addPlatform(y, kind, x) {
      const moving = kind === 'moving';
      S.plats.push({ x: x ?? 20 + rand() * (VW - PW - 40), y, kind, broken: false, brokenT: 0, spring: kind === 'spring', springT: -9,
        dir: rand() < 0.5 ? -1 : 1, speed: 50 + rand() * 50, ox: 0 });
      if (moving) S.plats[S.plats.length - 1].spd = 60 + rand() * 70;
      return S.plats[S.plats.length - 1];
    }
    function fill(upTo) {
      let y = S.plats.length ? S.plats[S.plats.length - 1].y : 0;
      while (y < upTo) {
        const lvl = clamp(y / 6000, 0, 1);                       /* 0 at the start, 1 at 600 m */
        y += 55 + rand() * (30 + 45 * lvl);                       /* never more than 130 apart */
        let kind = 'normal';
        const r = rand();
        if (prevKind !== 'breaking' && r < 0.08 + 0.28 * lvl) kind = 'breaking';
        else if (r < 0.34 + 0.2 * lvl) kind = 'moving';
        else if (rand() < 0.07) kind = 'spring';
        prevKind = kind;
        const c = addPlatform(y, kind);
        /* a crumbling cloud always has a sound one beside it at the same height, so there is always a way up */
        if (kind === 'breaking') addPlatform(y, 'normal', c.x < VW / 2 - PW / 2 ? VW - PW - 30 - rand() * 60 : 30 + rand() * 60);
      }
    }
    function newRound() {
      S.plats = []; S.parts = []; prevKind = 'normal';
      Object.assign(S, { state: 'ready', x: VW / 2, y: 60, vx: 0, vy: 0, cam: -100, top: 0, score: 0, bounces: 0, breaks: 0, springs: 0, combo: 0, maxCombo: 0, comboT: -9, over: false, lastTop: 0 });
      addPlatform(0, 'normal', VW / 2 - PW / 2);
      S.plats[0].start = true;
      fill(VH * 1.6);
      ctx.onScore(0);
    }

    /* ------------------------------ physics ------------------------------ */
    const axis = () => {
      let a = (S.keyR || S.ptrR.size > 0 ? 1 : 0) - (S.keyL || S.ptrL.size > 0 ? 1 : 0);
      if (!a && S.tiltOn && S.tilt !== null) a = clamp(S.tilt / 25, -1, 1);
      return a;
    };
    function burst(x, y, hue, n) {
      if (reduced) return;
      for (let i = 0; i < n; i++) { const a = rand() * 6.28, v = 40 + rand() * 90; S.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v + 40, t: 0, hue }); }
    }
    function step(dt) {
      S.time += dt;
      for (const p of S.parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy -= 300 * dt; p.t += dt; }
      S.parts = S.parts.filter(p => p.t < 0.6);
      for (const p of S.plats) {
        if (p.kind === 'moving' && !p.broken) { p.x += p.dir * p.spd * dt; if (p.x < 6) { p.x = 6; p.dir = 1; } if (p.x > VW - PW - 6) { p.x = VW - PW - 6; p.dir = -1; } }
        if (p.broken) p.brokenT += dt;
      }
      if (S.state === 'ready') { S.y = 60 + Math.sin(S.time * 5) * 3; return; }
      if (S.state !== 'play') return;
      /* steering: quick but not instant */
      const a = axis(), want = a * MAX_VX;
      S.vx += clamp(want - S.vx, -1900 * dt, 1900 * dt);
      if (a) S.face = a > 0 ? 1 : -1;
      const y0 = S.y;
      S.x += S.vx * dt;
      if (S.x < -HALF) S.x += VW + HALF * 2; else if (S.x > VW + HALF) S.x -= VW + HALF * 2;
      S.vy -= G * dt;
      S.y += S.vy * dt;
      /* landing: falling, feet crossing down through a cloud's top while over it */
      if (S.vy < 0) {
        for (const p of S.plats) {
          if (p.broken) continue;
          const top = p.y + PH / 2, f0 = y0 - 18, f1 = S.y - 18;
          if (f0 >= top && f1 <= top && S.x + HALF * 0.7 > p.x && S.x - HALF * 0.7 < p.x + PW) {
            if (p.kind === 'breaking') { p.broken = true; S.breaks++; burst(S.x, top, 30, 10); snd.blip(140, 0.18, 'sawtooth', 0.7, 60); continue; }
            S.y = top + 18;
            if (p.spring && S.x > p.x + PW * 0.25 && S.x < p.x + PW * 0.75) {
              /* springs one after another launch harder */
              S.combo = Math.min(S.combo + 1, 99); S.maxCombo = Math.max(S.maxCombo, S.combo);
              S.vy = SPRING * (1 + COMBO_STEP * (Math.min(S.combo, COMBO_MAX) - 1));
              p.springT = S.time; S.springs++; if (S.combo > 1) S.comboT = S.time;
              snd.blip(300 + (S.combo - 1) * 60, 0.2, 'triangle', 0.9, 900 + (S.combo - 1) * 120);
            }
            else { S.vy = BOUNCE; S.combo = 0; snd.blip(330, 0.07, 'triangle', 0.7, 520); }
            S.bounces++;
            burst(S.x, top, 190, 5);
            break;
          }
        }
      }
      if (S.y > S.top) S.top = S.y;
      const sc = Math.floor(S.top / px);
      if (sc !== S.score) { S.score = sc; ctx.onScore(sc); }
      /* the camera only climbs */
      S.cam = Math.max(S.cam, S.y - VH * 0.45);
      fill(S.cam + VH * 1.6);
      if (S.plats.length > 80) S.plats = S.plats.filter(p => p.y > S.cam - 200);
      if (S.y < S.cam - 40) die();
    }
    function die() {
      if (S.state !== 'play') return;
      S.state = 'over'; S.over = true;
      snd.blip(300, 0.5, 'sawtooth', 0.9, 60);
      /* the round as it ended (a test that puts the hopper back in play cancels it) */
      const detail = `You climbed ${S.score} m with ${S.bounces} bounces${S.springs ? ` and ${S.springs} spring${S.springs === 1 ? '' : 's'}` : ''}${S.maxCombo > 1 ? `, best spring combo ×${S.maxCombo}` : ''}.`;
      if (!S.fuzz) setTimeout(() => { if (!dead && S.over) ctx.onEnd({ score: S.score, detail }); }, reduced ? 300 : 800);
    }
    function begin() { if (S.state === 'ready') { S.state = 'play'; S.vy = BOUNCE; snd.blip(330, 0.07, 'triangle', 0.7, 520); } }

    const loop = looper(dt => {
      if (!S.paused && !S.frozen) for (let acc = dt; acc > 1e-9;) { const d = Math.min(DT, acc); step(d); acc -= d; }
      draw();
    });

    /* ------------------------------ drawing ------------------------------ */
    const sy = y => VH - (y - S.cam);                               /* world height -> screen y */
    function draw() {
      if (dead) return;
      const g = sf.g;
      sf.begin();
      V = fitView(sf, VW, VH, 4);
      g.fillStyle = '#050a14'; g.fillRect(0, 0, sf.w, sf.h);
      g.save();
      g.translate(V.ox, V.oy); g.scale(V.s, V.s);
      g.beginPath(); g.rect(0, 0, VW, VH); g.clip();
      /* the sky (the theme's) darkens with height */
      const TH = theme();
      const k = clamp(S.cam / 8000, 0, 1);
      const bg = g.createLinearGradient(0, 0, 0, VH);
      bg.addColorStop(0, hsl(TH.top[0] + TH.shift[0] * k, TH.top[1], Math.max(3, TH.top[2] + TH.shift[1] * k)));
      bg.addColorStop(1, hsl(TH.bot[0] + TH.shift[2] * k, TH.bot[1], Math.max(8, TH.bot[2] + TH.shift[3] * k)));
      g.fillStyle = bg; g.fillRect(0, 0, VW, VH);
      g.fillStyle = `rgba(${TH.star},.5)`;
      const many = TH === THEMES.space ? 90 : 40, bright = TH === THEMES.space ? 0.55 : 0.15;
      for (let i = 0; i < many; i++) { const sx = (i * 97 + (i > 40 ? 31 : 0)) % VW, syy = ((i * 61 + S.cam * (0.05 + (i % 3) * 0.03) * (reduced ? 0 : 1)) % VH); g.globalAlpha = bright + k * 0.6 * ((i % 4) / 4); g.fillRect(sx, VH - syy, 1.6, 1.6); }
      g.globalAlpha = 1;
      if (TH === THEMES.sunset) {             /* a low sun that sinks as you climb */
        const sunY = VH - 90 + Math.min(200, S.cam * 0.02);
        const sun = g.createRadialGradient(VW * 0.7, sunY, 4, VW * 0.7, sunY, 70);
        sun.addColorStop(0, 'rgba(255,236,170,.95)'); sun.addColorStop(0.35, 'rgba(255,170,90,.5)'); sun.addColorStop(1, 'rgba(255,120,80,0)');
        g.fillStyle = sun; g.fillRect(0, 0, VW, VH);
      } else if (TH === THEMES.space) {        /* a ringed planet far off */
        const py = 140 + ((S.cam * 0.03) % (VH + 200));
        g.fillStyle = 'rgba(150,120,255,.55)'; g.beginPath(); g.arc(VW * 0.22, py, 26, 0, 7); g.fill();
        g.strokeStyle = 'rgba(220,200,255,.5)'; g.lineWidth = 2; g.beginPath(); g.ellipse(VW * 0.22, py, 44, 9, -0.3, 0, 7); g.stroke();
      }
      /* clouds */
      for (const p of S.plats) {
        const y = sy(p.y);
        if (y < -40 || y > VH + 40) continue;
        if (p.broken) { if (p.brokenT < 0.8) { g.globalAlpha = 1 - p.brokenT / 0.8; const d = reduced ? 0 : p.brokenT * 220; cloud(g, p.x - 4, y + d * 0.2, PW / 2, p.kind, -d * 0.1); cloud(g, p.x + PW / 2 + 4, y + d, PW / 2, p.kind, d * 0.1); g.globalAlpha = 1; } continue; }
        cloud(g, p.x, y, PW, p.kind, 0);
        if (p.spring) {
          const comp = S.time - p.springT < 0.18 ? 1 : 0, sx = p.x + PW / 2;
          g.strokeStyle = '#d7d7e6'; g.lineWidth = 2; g.beginPath(); g.moveTo(sx - 7, y - 3);
          for (let i = 0; i < 4; i++) { g.lineTo(sx + 7, y - 6 - i * (comp ? 1.5 : 3)); g.lineTo(sx - 7, y - 8 - i * (comp ? 1.5 : 3)); } g.stroke();
          g.fillStyle = '#ff4d6d'; rr(g, sx - 10, y - 12 - (comp ? 6 : 14), 20, 5, 2); g.fill();
        }
      }
      for (const p of S.parts) { g.fillStyle = hsl(p.hue, 80, 80, 1 - p.t / 0.6); g.fillRect(p.x, sy(p.y), 3, 3); }
      /* the hopper, drawn wrapped if it is half off one side */
      for (const off of [0, VW + HALF * 2, -(VW + HALF * 2)]) if (S.state !== 'over' || S.y > S.cam - 40) hopper(g, S.x + off, sy(S.y));
      g.restore();
      /* the score */
      g.save();
      g.translate(V.ox, V.oy); g.scale(V.s, V.s);
      g.textBaseline = 'top'; g.textAlign = 'left'; g.font = `800 24px ${FONT}`; g.fillStyle = '#fff'; g.shadowBlur = 6; g.shadowColor = 'rgba(0,0,0,.6)';
      g.fillText(`${S.score} m`, 14, 12);
      /* a spring combo, for a moment after each spring in a row */
      if (S.combo > 1 && S.time - S.comboT < 1.4) {
        g.textAlign = 'center'; g.font = `800 20px ${FONT}`;
        g.fillStyle = `rgba(255,120,150,${clamp(1.4 - (S.time - S.comboT), 0, 1)})`;
        g.fillText(`Spring combo ×${S.combo}`, VW / 2, 52);
      }
      g.restore();
      if (S.state === 'ready') prompt(g, sf, coarse() ? 'Touch left or right to start' : 'Press ← or → to start', 'Steer the hopper from cloud to cloud', 195, sf.h * 0.55);
      if (S.paused) prompt(g, sf, 'Paused', null, 195);
      if (coarse() && typeof DeviceOrientationEvent !== 'undefined' && S.state !== 'over') { /* the Tilt button */
        g.save(); g.font = `600 12px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
        const bx = V.ox + (VW - 46) * V.s, by = V.oy + 26 * V.s;
        g.fillStyle = S.tiltOn ? 'rgba(120,230,160,.85)' : 'rgba(0,0,0,.45)'; rr(g, bx - 22, by - 12, 44, 24, 8); g.fill();
        g.fillStyle = '#fff'; g.fillText('Tilt', bx, by + 1); g.restore();
      }
    }
    function cloud(g, x, y, w, kind, tilt) {
      const hh = PH;
      g.save(); g.translate(x + w / 2, y); g.rotate(tilt);
      const base = theme().clouds[kind === 'breaking' ? 'breaking' : kind === 'moving' ? 'moving' : 'normal'];
      const gr = g.createLinearGradient(0, -hh / 2, 0, hh / 2); gr.addColorStop(0, base[0]); gr.addColorStop(1, base[1]);
      g.fillStyle = gr; rr(g, -w / 2, -hh / 2, w, hh, 6); g.fill();
      g.beginPath(); g.arc(-w * 0.22, -hh / 2, 7, 0, 7); g.arc(w * 0.05, -hh / 2 - 2, 9, 0, 7); g.arc(w * 0.3, -hh / 2, 6.5, 0, 7); g.fill();
      if (kind === 'breaking') { g.strokeStyle = '#4a3018'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(-4, -hh / 2); g.lineTo(0, 0); g.lineTo(-3, hh / 2); g.moveTo(14, -hh / 2); g.lineTo(10, 1); g.stroke(); }
      if (kind === 'moving') { g.fillStyle = 'rgba(0,70,110,.55)'; g.beginPath(); g.moveTo(-w / 2 + 8, 0); g.lineTo(-w / 2 + 14, -3); g.lineTo(-w / 2 + 14, 3); g.moveTo(w / 2 - 8, 0); g.lineTo(w / 2 - 14, -3); g.lineTo(w / 2 - 14, 3); g.fill(); }
      g.restore();
    }
    function hopper(g, x, y) {
      g.save(); g.translate(x, y);
      const sq = S.vy > 0 ? 1 + Math.min(0.12, S.vy / 6000) : 1 - Math.min(0.08, -S.vy / 9000);
      g.scale(S.face / sq, sq);
      g.fillStyle = 'rgba(0,0,0,.18)'; g.beginPath(); g.ellipse(0, 18, 10, 3, 0, 0, 7); g.fill();
      g.fillStyle = '#7be07b'; g.beginPath(); g.ellipse(0, 0, 14, 15, 0, 0, 7); g.fill();
      g.fillStyle = '#4fb34f'; g.beginPath(); g.ellipse(0, 6, 9, 8, 0, 0, 7); g.fill();
      g.strokeStyle = '#4fb34f'; g.lineWidth = 4; g.lineCap = 'round'; g.beginPath(); g.moveTo(-8, 12); g.lineTo(-11, 18 + (S.vy > 0 ? 3 : -2)); g.moveTo(8, 12); g.lineTo(11, 18 + (S.vy > 0 ? 3 : -2)); g.stroke();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(-4, -8, 4.5, 0, 7); g.arc(6, -8, 4.5, 0, 7); g.fill();
      g.fillStyle = '#10200a'; g.beginPath(); g.arc(-3, -8, 2, 0, 7); g.arc(7, -8, 2, 0, 7); g.fill();
      g.restore();
    }

    /* ------------------------------ input ------------------------------ */
    const L = ['ArrowLeft', 'KeyA'], Rk = ['ArrowRight', 'KeyD'], held = new Set();
    const onKey = e => {
      if (!ownsKey(el, e) || dead) return;
      const c = e.code;
      if (c === 'KeyT') { e.preventDefault(); enableTilt(); return; }
      const l = L.includes(c), r = Rk.includes(c);
      if (!l && !r) return;
      e.preventDefault(); snd.wake();
      if (S.paused) return;
      held.add(c);
      if (l) S.keyL = true;
      if (r) S.keyR = true;
      begin();
    };
    const onKeyUp = e => {
      held.delete(e.code);
      if (!L.some(k => held.has(k))) S.keyL = false;
      if (!Rk.some(k => held.has(k))) S.keyR = false;
    };
    const onBlur = () => { held.clear(); S.keyL = S.keyR = false; S.ptrL.clear(); S.ptrR.clear(); };
    const onDown = e => {
      if (e.button > 0 || S.paused) return;
      snd.wake();
      const rc = sf.cv.getBoundingClientRect();
      if (coarse() && typeof DeviceOrientationEvent !== 'undefined' && e.clientX > rc.right - 70 && e.clientY < rc.top + 50) { enableTilt(); return; }
      try { sf.cv.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
      (e.clientX - rc.left < rc.width / 2 ? S.ptrL : S.ptrR).add(e.pointerId);
      begin();
    };
    const onUp = e => { S.ptrL.delete(e.pointerId); S.ptrR.delete(e.pointerId); };
    /* tilt steering: only after the device grants permission */
    const onTilt = e => { if (typeof e.gamma === 'number') S.tilt = e.gamma; };
    async function enableTilt() {
      if (S.tiltOn) { S.tiltOn = false; window.removeEventListener('deviceorientation', onTilt); return; }
      if (typeof DeviceOrientationEvent === 'undefined') return;
      try {
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
          const r = await DeviceOrientationEvent.requestPermission();
          if (r !== 'granted') return;
        }
      } catch (err) { return; }
      if (dead) return;
      window.addEventListener('deviceorientation', onTilt);
      S.tiltOn = true;
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    sf.cv.addEventListener('pointerdown', onDown);
    sf.cv.addEventListener('pointerup', onUp);
    sf.cv.addEventListener('pointercancel', onUp);

    newRound();
    draw();
    loop.start();

    return {
      stop() {
        dead = true;
        loop.stop();
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onBlur);
        window.removeEventListener('deviceorientation', onTilt);
        sf.cv.removeEventListener('pointerdown', onDown);
        sf.cv.removeEventListener('pointerup', onUp);
        sf.cv.removeEventListener('pointercancel', onUp);
        snd.close();
        sf.destroy();
      },
      pause() { S.paused = true; onBlur(); loop.stop(); draw(); },
      resume() { S.paused = false; if (!S.over) loop.start(); },
      peek: () => ({
        state: S.state, paused: S.paused, time: S.time, score: S.score, x: S.x, y: S.y, vx: S.vx, vy: S.vy, cam: S.cam, top: S.top,
        bounces: S.bounces, breaks: S.breaks, springs: S.springs, tiltOn: S.tiltOn, axis: axis(), bounceSpeed: BOUNCE, springSpeed: SPRING,
        combo: S.combo, maxCombo: S.maxCombo, theme: Object.keys(THEMES).find(k => THEMES[k] === theme()),
        plats: S.plats.map(p => ({ x: p.x, y: p.y, kind: p.kind, broken: p.broken, spring: p.spring })), over: S.over, w: VW, plat: PW,
      }),
      /* test hook — nothing in the game calls it:
         freeze(bool) · step(seconds) · clear() (no clouds) · cloud({ x, y, kind }) · place({ x, y, vx, vy }) · start() · seed(n) · fill(height) */
      hook(cmd, arg) {
        if (cmd === 'freeze') S.frozen = !!arg;
        else if (cmd === 'step') { for (let t = 0; t < arg - 1e-9; t += DT) step(Math.min(DT, arg - t)); }
        else if (cmd === 'clear') { S.plats = []; prevKind = 'normal'; }
        else if (cmd === 'cloud') addPlatform(arg.y, arg.kind || 'normal', arg.x ?? VW / 2 - PW / 2);
        else if (cmd === 'place') { S.x = arg.x ?? S.x; S.y = arg.y ?? S.y; S.vx = arg.vx || 0; S.vy = arg.vy || 0; if (!arg.keepCam) S.cam = S.y - VH * 0.45; S.top = Math.max(S.top, S.y); if (S.state === 'over') { S.state = 'play'; S.over = false; } }
        else if (cmd === 'start') begin();
        else if (cmd === 'seed') { rand = rng(arg >>> 0); newRound(); }
        else if (cmd === 'fill') fill(arg);
        else return false;
        draw();
        return true;
      },
    };
  },
};
