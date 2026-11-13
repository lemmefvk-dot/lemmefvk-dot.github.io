/* ============================================================
   arcade/lap.js — Lap Rush for Static Arcade: a time trial with a
   ghost of your own best lap.

   The existing racer, Neon Lanes (./racer.js), is an endless
   traffic-dodger with no laps, tracks or lap times, so there is
   nothing in it to keep a "best lap" of: this is a separate racer.

   A cup is one standing-start lap on each of three circuits. Drive
   with ↑ / W (throttle), ↓ / S (brake, then reverse) and ← → / A D
   (steer); the grass slows you. Score = the three lap times added
   up, in seconds (lower is better).

   The ghost: every lap is recorded at 20 samples a second. When a
   lap beats the best one kept for that circuit, it becomes the new
   ghost; a slower lap changes nothing. Next time on that circuit a
   translucent car replays the ghost lap beside you (it can't touch
   you) and the clock shows the gap to it: negative, in green, means
   you are ahead. Ghosts are saved in the Arcade's own store, at
   most 80 s / about 30 KB each, survive a reload, and "Clear ghosts"
   (press twice) forgets them all.

   Fixed 1/120 s steps (./fixed.js): the same car at any frame rate.
   Follows the module contract in ./index.js.
   ============================================================ */
import { h } from '../core/dom.js';
import { store } from '../core/store.js';
import { clamp, hsl, FONT, coarse, fitView, surface, sounder, looper, rr, prompt } from './kit.js';
import { ownsKey } from './boardkit.js';
import { fixedStepper } from './fixed.js';
import { WORLD, HALF, GHOST_HZ, MAX_LAP_MS, TRACKS, circuit, newCar, stepCar, speedOf, autoDrive, packGhost, readGhost, ghostBytes, ghostAt, ghostProgress, ghostTimeAt } from './lap-track.js';

const KEY = 'portal.arcadeLapRush';
const DT = 1 / 120, PER_SAMPLE = 120 / GHOST_HZ;
const COUNT = 3, LAP_CAP = 90;
const MAX_BYTES = 30000;

const readStore = () => {
  let p = null;
  try { p = store.get(KEY, null); } catch (err) { p = null; }
  const ghosts = {};
  for (const t of TRACKS) { const g = readGhost(p?.ghosts?.[t.id]); if (g) ghosts[t.id] = g; }
  return { show: p?.show !== false, ghosts };
};
const writeStore = (show, ghosts) => { try { store.set(KEY, { v: 1, show, ghosts }); } catch (err) { /* a convenience */ } };

const fmt = ms => { const s = ms / 1000, m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`; };
const fmtGap = s => `${s <= 0 ? '−' : '+'}${Math.abs(s).toFixed(2)}`;

const CSS = `
.lr-bar{position:absolute;top:8px;right:8px;z-index:3;display:flex;gap:6px}
.lr-bar button{font:600 12px/1 var(--font,system-ui);color:#e8ecf4;background:rgba(10,14,22,.82);border:1px solid rgba(255,255,255,.2);border-radius:9px;padding:8px 11px;cursor:pointer}
.lr-bar button[aria-pressed="true"]{border-color:rgba(120,230,255,.7);color:#bff3ff}
.lr-bar button.is-warn{color:#ffd6dc;border-color:rgba(255,110,130,.65);background:rgba(120,20,40,.8)}
.lr-bar button:focus-visible{outline:2px solid #7be0ff;outline-offset:2px}
.lr-pad{position:absolute;left:0;right:0;bottom:8px;z-index:3;display:flex;justify-content:space-between;padding:0 10px;pointer-events:none}
.lr-pad div{display:flex;gap:8px;pointer-events:auto}
.lr-pad button{width:62px;height:62px;border-radius:16px;font:700 20px/1 var(--font,system-ui);color:#fff;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.3);touch-action:none}
.lr-pad button.on{background:rgba(120,230,255,.4)}
`;

export default {
  mount(el, ctx) {
    const reduced = !!ctx.reduced;
    const snd = sounder(ctx);
    const saved = readStore();
    const S = {
      state: 'ready',                                  /* ready | count | race | lap | done */
      paused: false, over: false, time: 0,
      ti: 0, tr: circuit(TRACKS[0].id), car: null,
      countT: COUNT, lapT: 0, steps: 0, rec: [], results: [], total: 0,
      keys: { thr: 0, brake: 0, steer: 0 }, pad: { thr: 0, brake: 0, left: 0, right: 0 }, auto: null,
      ghosts: saved.ghosts, show: saved.show, gp: null, gpFor: '',
      cardT: 0, endT: 0, last: null, usedInput: false, lastSecond: 3,
    };
    let dead = false;
    const refocus = () => el.closest('[tabindex]')?.focus({ preventScroll: true });

    /* ------------------------------ the page ------------------------------ */
    const stage = h('div', { style: { position: 'absolute', inset: '0' } });
    const showBtn = h('button', { type: 'button', 'aria-pressed': String(S.show), title: 'Show or hide your best-lap ghost', onclick: () => { S.show = !S.show; showBtn.setAttribute('aria-pressed', String(S.show)); persist(); draw(); refocus(); } }, h('span', { text: 'Ghost' }));
    let armed = 0;
    const clearBtn = h('button', { type: 'button', title: 'Forget every saved ghost', onclick: () => {
      if (armed) { clearTimeout(armed); armed = 0; clearBtn.classList.remove('is-warn'); label.textContent = 'Clear ghosts'; S.ghosts = {}; S.gp = null; S.gpFor = ''; persist(); say('Ghosts cleared'); draw(); refocus(); return; }
      clearBtn.classList.add('is-warn'); label.textContent = 'Press again to clear';
      armed = setTimeout(() => { armed = 0; clearBtn.classList.remove('is-warn'); label.textContent = 'Clear ghosts'; }, 3000);
      refocus();
    } });
    const label = h('span', { text: 'Clear ghosts' });
    clearBtn.append(label);
    const bar = h('div.lr-bar', showBtn, clearBtn);
    const root = h('div', { style: { position: 'absolute', inset: '0' } }, h('style', { text: CSS }), stage, bar);
    el.appendChild(root);
    let padEl = null;
    if (coarse()) {
      const mk = (txt, k, aria) => {
        const b = h('button', { type: 'button', text: txt, 'aria-label': aria });
        const on = e => { e.preventDefault(); S.pad[k] = 1; b.classList.add('on'); snd.wake(); wake(); };
        const off = () => { S.pad[k] = 0; b.classList.remove('on'); };
        b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('pointerleave', off);
        return b;
      };
      padEl = h('div.lr-pad', h('div', mk('◀', 'left', 'Steer left'), mk('▶', 'right', 'Steer right')), h('div', mk('■', 'brake', 'Brake'), mk('▲', 'thr', 'Accelerate')));
      root.appendChild(padEl);
    }
    const sf = surface(stage, 'Lap Rush circuit', () => draw());
    let V = fitView(sf, WORLD.w, WORLD.h, 6);
    ctx.onScore(0);

    function persist() { writeStore(S.show, S.ghosts); }
    function say(t) { S.msg = t; S.msgT = S.time; }

    /* ------------------------------ rules ------------------------------ */
    const ghost = () => S.ghosts[S.tr.id] || null;
    function ghostProg() {
      const g = ghost();
      if (!g) return null;
      if (S.gpFor !== S.tr.id + ':' + g.t) { S.gp = ghostProgress(S.tr, g); S.gpFor = S.tr.id + ':' + g.t; }
      return S.gp;
    }
    function gapNow() {
      const g = ghost();
      if (!g || S.state !== 'race') return null;
      const gp = ghostProg();
      const tg = ghostTimeAt(g, gp, S.car.prog);
      return tg === null ? null : S.lapT - tg;
    }
    function loadTrack(i) {
      S.ti = i; S.tr = circuit(TRACKS[i].id); S.car = newCar(S.tr);
      S.state = 'ready'; S.lapT = 0; S.steps = 0; S.rec = []; S.countT = COUNT; S.lastSecond = 3;
    }
    function wake() {
      if (S.state === 'ready') { S.state = 'count'; S.countT = COUNT; S.lastSecond = 3; S.usedInput = true; snd.blip(440, 0.1, 'square', 0.6); }
      else if (S.state === 'lap') nextTrack();
    }
    function go() {
      S.state = 'race'; S.lapT = 0; S.steps = 0;
      S.rec = [{ x: S.car.x, y: S.car.y, h: S.car.h }];
      snd.blip(880, 0.3, 'square', 0.8);
    }
    function lapDone(ms, aborted) {
      const g = ghost();
      const gap = g && !aborted ? (ms - g.t) / 1000 : null;
      let status = 'first', kept = false;
      if (aborted) status = 'slow';
      else if (g && ms >= g.t) status = 'kept';
      else {
        status = g ? 'new' : 'first';
        const pack = packGhost(S.rec, ms);
        const clean = readGhost(pack);
        if (clean && ghostBytes(clean) <= MAX_BYTES && ms <= MAX_LAP_MS) { S.ghosts[S.tr.id] = clean; S.gp = null; S.gpFor = ''; persist(); kept = true; }
        else status = 'toolong';
      }
      S.results[S.ti] = ms;
      S.total = S.results.reduce((a, b) => a + (b || 0), 0);
      S.last = { ms, gap, status, kept, track: S.tr.id };
      S.state = 'lap'; S.cardT = 0;
      snd.blip(status === 'new' || status === 'first' ? 700 : 400, 0.2, 'triangle', 0.9, 1000);
      ctx.onScore(Math.round(S.total / 10) / 100);
    }
    function nextTrack() {
      if (S.state !== 'lap') return;
      if (S.ti >= TRACKS.length - 1) { S.state = 'done'; S.endT = 0; return; }
      loadTrack(S.ti + 1);
    }
    function finish() {
      if (S.over || dead) return;
      S.over = true;
      const sec = Math.round(S.total / 10) / 100;
      ctx.onEnd({ score: sec, won: true, detail: `Three circuits in ${sec.toFixed(2)} s (${S.results.map(fmt).join(', ')}).` });
    }

    /* ------------------------------ one fixed step ------------------------------ */
    function inputNow() {
      if (S.auto) return autoDrive(S.car, S.tr, S.auto.cap ?? 1);
      const k = S.keys, p = S.pad;
      return { thr: Math.max(k.thr, p.thr), brake: Math.max(k.brake, p.brake), steer: clamp(k.steer + p.right - p.left, -1, 1) };
    }
    function step(dt) {
      S.time += dt;
      if (S.state === 'count') {
        S.countT -= dt;
        const sec = Math.ceil(S.countT);
        if (sec < S.lastSecond && sec > 0) { S.lastSecond = sec; snd.blip(440, 0.1, 'square', 0.6); }
        if (S.countT <= 0) go();
      } else if (S.state === 'race') {
        const prevProg = S.car.prog;
        stepCar(S.car, S.tr, inputNow(), dt);
        S.lapT += dt; S.steps++;
        if (S.steps % PER_SAMPLE === 0 && S.rec.length < 2400) S.rec.push({ x: S.car.x, y: S.car.y, h: S.car.h });
        if (S.car.prog >= S.tr.N) {
          const f = (S.car.prog - S.tr.N) / Math.max(1e-9, S.car.prog - prevProg);
          S.rec.push({ x: S.car.x, y: S.car.y, h: S.car.h });
          lapDone(Math.round((S.lapT - f * dt) * 1000), false);
        } else if (S.lapT > LAP_CAP) lapDone(LAP_CAP * 1000, true);
      } else if (S.state === 'lap') {
        S.cardT += dt;
        if (S.cardT >= 3.2) nextTrack();
      } else if (S.state === 'done') {
        S.endT += dt;
        if (S.endT >= (reduced ? 0.4 : 1.2)) finish();
      }
    }
    const stepper = fixedStepper(DT, step);
    const loop = looper(dt => {
      if (S.paused) return;
      stepper.advance(dt);
      draw();
    });

    /* ------------------------------ drawing ------------------------------ */
    const pathOf = new Map();
    function trackPath(tr) {
      if (pathOf.has(tr.id)) return pathOf.get(tr.id);
      const p = new Path2D();
      tr.c.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
      p.closePath();
      pathOf.set(tr.id, p);
      return p;
    }
    function carShape(g, x, y, hd, body, alpha, glow) {
      g.save(); g.translate(x, y); g.rotate(hd); g.globalAlpha = alpha;
      if (glow) { g.shadowColor = glow; g.shadowBlur = 10; }
      g.fillStyle = 'rgba(0,0,0,.35)'; rr(g, -11, -5.5, 24, 13, 4); g.fill();
      g.fillStyle = body; rr(g, -12, -7, 25, 14, 4); g.fill();
      g.shadowBlur = 0;
      g.fillStyle = 'rgba(255,255,255,.55)'; rr(g, -2, -4.6, 9, 9.2, 2.5); g.fill();
      g.fillStyle = '#fff6c4'; g.fillRect(10, -6, 3, 3); g.fillRect(10, 3, 3, 3);
      g.fillStyle = '#ff5050'; g.fillRect(-12, -6, 2, 3); g.fillRect(-12, 3, 2, 3);
      g.restore();
    }
    function drawTrack(g) {
      const tr = S.tr;
      g.fillStyle = hsl(tr.hue + 100, 30, 14); g.fillRect(0, 0, WORLD.w, WORLD.h);
      g.fillStyle = hsl(tr.hue + 100, 30, 17);
      for (let x = 0; x < WORLD.w; x += 80) g.fillRect(x, 0, 40, WORLD.h);
      const P = trackPath(tr);
      g.lineJoin = 'round'; g.lineCap = 'round';
      g.strokeStyle = '#d8d8d8'; g.lineWidth = HALF * 2 + 12; g.setLineDash([16, 16]); g.stroke(P);
      g.strokeStyle = '#d6372f'; g.lineDashOffset = 16; g.stroke(P);
      g.setLineDash([]); g.lineDashOffset = 0;
      g.strokeStyle = '#2a2e38'; g.lineWidth = HALF * 2; g.stroke(P);
      g.strokeStyle = 'rgba(255,255,255,.16)'; g.lineWidth = 2; g.setLineDash([14, 22]); g.stroke(P); g.setLineDash([]);
      /* the line: a chequered strip across the road at the start */
      const s = tr.start, nx = -Math.sin(s.h), ny = Math.cos(s.h);
      for (let k = -HALF; k < HALF; k += 8) for (let j = 0; j < 2; j++) {
        g.fillStyle = ((k / 8 + j) & 1) ? '#111' : '#f4f4f4';
        g.fillRect(s.x + nx * (k + 4) + Math.cos(s.h) * (j * 7 - 7) - 4, s.y + ny * (k + 4) + Math.sin(s.h) * (j * 7 - 7) - 4, 8, 8);
      }
    }
    function hud(g) {
      g.textBaseline = 'middle';
      g.fillStyle = 'rgba(8,12,20,.78)'; rr(g, 16, 14, 330, 74, 12); g.fill();
      g.textAlign = 'left'; g.fillStyle = hsl(S.tr.hue, 80, 78); g.font = `700 13px ${FONT}`;
      g.fillText(`${S.tr.name.toUpperCase()}  ·  ${S.ti + 1} / ${TRACKS.length}`, 30, 33);
      g.fillStyle = '#f4f7fb'; g.font = `800 28px ${FONT}`;
      g.fillText(fmt(Math.round(S.state === 'race' ? S.lapT * 1000 : S.state === 'lap' && S.last ? S.last.ms : 0)), 30, 63);
      const gh = ghost();
      g.font = `600 12px ${FONT}`; g.fillStyle = hsl(190, 40, 78);
      g.fillText(gh ? `Best lap ${fmt(gh.t)}` : 'No ghost yet', 168, 40);
      const gap = S.show ? gapNow() : null;
      if (gap !== null) {
        g.font = `800 22px ${FONT}`; g.fillStyle = gap <= 0 ? '#7dffa0' : '#ff9a8a';
        g.fillText(fmtGap(gap), 168, 66);
      } else if (gh && !S.show) { g.font = `500 12px ${FONT}`; g.fillStyle = 'rgba(255,255,255,.5)'; g.fillText('ghost hidden', 168, 66); }
      /* speed */
      const sp = speedOf(S.car);
      g.fillStyle = 'rgba(8,12,20,.78)'; rr(g, WORLD.w - 196, WORLD.h - 52, 180, 36, 10); g.fill();
      g.fillStyle = sp > 270 ? '#ffd86a' : '#7be0ff'; rr(g, WORLD.w - 190, WORLD.h - 40, Math.max(3, 168 * sp / 310), 12, 6); g.fill();
    }
    function draw() {
      if (dead) return;
      const g = sf.g;
      sf.begin();
      V = fitView(sf, WORLD.w, WORLD.h, 4);
      g.fillStyle = '#080b12'; g.fillRect(0, 0, sf.w, sf.h);
      g.save(); g.translate(V.ox, V.oy); g.scale(V.s, V.s);
      g.beginPath(); g.rect(0, 0, WORLD.w, WORLD.h); g.clip();
      drawTrack(g);
      if (S.show && ghost()) {
        const t = S.state === 'race' ? S.lapT : 0;
        const p = ghostAt(ghost(), t);
        if (p && (S.state === 'race' || S.state === 'ready' || S.state === 'count')) carShape(g, p.x, p.y, p.h, '#6fe3ff', 0.4, 'rgba(120,230,255,.8)');
      }
      carShape(g, S.car.x, S.car.y, S.car.h, '#ff4fd8', 1, null);
      hud(g);
      g.textAlign = 'center';
      if (S.state === 'count') {
        const n = Math.ceil(S.countT);
        g.fillStyle = '#fff'; g.font = `800 ${reduced ? 90 : 90 + Math.round((S.countT % 1) * 30)}px ${FONT}`; g.fillText(String(Math.max(1, n)), WORLD.w / 2, 160);
      } else if (S.state === 'race' && S.lapT < 0.8) {
        g.fillStyle = '#7dffa0'; g.font = `800 64px ${FONT}`; g.fillText('GO', WORLD.w / 2, 160);
      }
      if (S.state === 'lap' && S.last) {
        const L = S.last;
        g.fillStyle = 'rgba(8,12,20,.9)'; rr(g, WORLD.w / 2 - 190, 150, 380, 190, 16); g.fill();
        g.strokeStyle = 'rgba(255,255,255,.2)'; rr(g, WORLD.w / 2 - 190, 150, 380, 190, 16); g.stroke();
        g.fillStyle = '#f4f7fb'; g.font = `700 20px ${FONT}`; g.fillText(`${S.tr.name}: ${fmt(L.ms)}`, WORLD.w / 2, 190);
        g.font = `600 16px ${FONT}`;
        const line = { first: 'First lap: ghost saved', new: `New best lap! ${fmtGap(L.gap)} s: ghost replaced`, kept: `${fmtGap(L.gap)} s: your ghost stays`, slow: 'Too slow: no ghost kept', toolong: 'Lap too long to save as a ghost' }[L.status];
        g.fillStyle = L.status === 'new' || L.status === 'first' ? '#7dffa0' : '#ffd0a8'; g.fillText(line, WORLD.w / 2, 226);
        g.fillStyle = hsl(200, 30, 78); g.font = `500 14px ${FONT}`;
        g.fillText(`Cup so far: ${fmt(S.total)}`, WORLD.w / 2, 262);
        g.fillStyle = 'rgba(255,255,255,.6)'; g.font = `500 13px ${FONT}`;
        g.fillText(S.ti >= TRACKS.length - 1 ? (coarse() ? 'Tap to finish' : 'Space to finish') : (coarse() ? 'Tap for the next circuit' : 'Space for the next circuit'), WORLD.w / 2, 306);
      }
      g.restore();
      if (S.state === 'ready' && !S.paused) prompt(g, sf, coarse() ? 'Tap ▲ to start the countdown' : 'Press ↑ or Space to start', ghost() ? `Beat your ghost: ${fmt(ghost().t)}` : 'Three circuits, one lap each: lowest total wins', S.tr.hue, sf.h * 0.88);
      if (S.paused) prompt(g, sf, 'Paused', null, S.tr.hue);
    }

    /* ------------------------------ input ------------------------------ */
    const K = {
      ArrowUp: ['thr', 1], w: ['thr', 1], ArrowDown: ['brake', 1], s: ['brake', 1],
      ArrowLeft: ['steer', -1], a: ['steer', -1], ArrowRight: ['steer', 1], d: ['steer', 1],
    };
    const held = new Set();
    const recompute = () => {
      S.keys.thr = (held.has('ArrowUp') || held.has('w')) ? 1 : 0;
      S.keys.brake = (held.has('ArrowDown') || held.has('s')) ? 1 : 0;
      S.keys.steer = ((held.has('ArrowRight') || held.has('d')) ? 1 : 0) - ((held.has('ArrowLeft') || held.has('a')) ? 1 : 0);
    };
    const onKey = e => {
      if (!ownsKey(el, e) || dead) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (K[k]) {
        e.preventDefault(); snd.wake();
        if (S.paused) return;
        held.add(k); recompute();
        if (S.state === 'ready' || S.state === 'lap') wake();
        return;
      }
      if (e.key === ' ' || e.key === 'Enter') {
        if (S.over || S.state === 'done') return;           /* Enter plays again: the Arcade's */
        e.preventDefault(); snd.wake();
        if (S.paused || e.repeat) return;
        wake();
      }
    };
    const onKeyUp = e => { const k = e.key.length === 1 ? e.key.toLowerCase() : e.key; if (K[k]) { held.delete(k); recompute(); } };
    const onBlur = () => { held.clear(); recompute(); };
    const onDown = () => { if (S.paused) return; snd.wake(); if (S.state === 'lap') nextTrack(); else if (S.state === 'ready' && !coarse()) wake(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    sf.cv.addEventListener('pointerdown', onDown);

    loadTrack(0);
    draw();
    loop.start();

    return {
      stop() {
        dead = true;
        loop.stop();
        clearTimeout(armed);
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onBlur);
        sf.cv.removeEventListener('pointerdown', onDown);
        snd.close();
        sf.destroy();
        root.remove();
      },
      pause() { S.paused = true; held.clear(); recompute(); loop.stop(); draw(); },
      resume() { S.paused = false; stepper.reset(); if (!S.over) loop.start(); },
      peek: () => {
        const g = ghost(), gap = gapNow(), gp = g && S.state === 'race' ? ghostAt(g, S.lapT) : null;
        return {
          state: S.state, paused: S.paused, over: S.over, time: S.time, track: S.tr.id, trackName: S.tr.name, trackIndex: S.ti, tracks: TRACKS.length,
          lapT: S.lapT, steps: S.steps, results: S.results.slice(), total: S.total, count: S.countT, N: S.tr.N,
          car: { x: S.car.x, y: S.car.y, h: S.car.h, speed: speedOf(S.car), onRoad: S.car.onRoad, prog: S.car.prog },
          keys: { ...S.keys }, samples: S.rec.length,
          ghost: { has: !!g, ms: g ? g.t : null, shown: S.show, gap: S.show ? gap : null, pos: gp, samples: g ? g.n : 0 },
          ghosts: Object.fromEntries(Object.entries(S.ghosts).map(([k, v]) => [k, v.t])), last: S.last,
        };
      },
      /* test hook — nothing in the game calls it:
         auto({ cap 0..1 } | null) · step(seconds) · begin() · goto(i) · next() */
      hook(cmd, arg) {
        if (cmd === 'auto') S.auto = arg || null;
        else if (cmd === 'step') { for (let t = 0; t < arg - 1e-9; t += DT) step(DT); }
        else if (cmd === 'begin') { if (S.state === 'ready' || S.state === 'count') go(); }
        else if (cmd === 'goto') loadTrack(clamp(arg | 0, 0, TRACKS.length - 1));
        else if (cmd === 'next') nextTrack();
        else return false;
        draw();
        return true;
      },
    };
  },
};
