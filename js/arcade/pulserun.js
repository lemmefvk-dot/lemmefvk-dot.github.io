/* ============================================================
   arcade/pulserun.js — Pulse Run for Static Arcade.

   A glowing bead runs right across a neon course at a steady pace and
   you hold one button to jump, in time with original music. Twelve
   hand-made levels that get harder, a Mixtape course made from a seed
   (so a Beat-this link is the same course), a practice mode with
   checkpoints, and a level editor whose levels share as a code.

   Controls   Space, ↑, W, a click, a tap or any controller button:
              hold to jump (a tap hops, a hold is the full jump)
              C drops a checkpoint in practice · T turns practice on or off
   Gravity gates turn the world over, jump pads throw you high, and
   wind makes the button a lift. One-button mode lets any key jump.
   Score = how far you got, in percent (100 = the level finished).

   THE RULES are in ./pulserun-sim.js: a fixed 1/240 s step, so the same
   presses give the same run at any frame rate, and a run is just the
   list of steps the button changed on (the replay, the ghost, the proof
   inside a level code). THE CLOCK is the audio clock: the music is
   scheduled on it and the level is run from it (./pulserun-music.js).
   With no running audio clock the level runs from performance.now() in
   silence and the game says so.

   Smooth on slow devices: one canvas, no allocations in the frame loop
   (particles are a fixed pool, text is cached), tiles are drawn only
   where visible, and when frames run long the scenery simplifies by
   itself (quality 2 → 1 → 0). The loop stops while paused and while the
   window is hidden. Reduced motion: no shake, no flashes, no pulsing
   backdrop, no trail.

   Test hook: el.arcadeHook(cmd, arg). Snapshot: el.arcadePeek().
   ============================================================ */
import { surface, ownsKey, looper, prompt, FONT, clamp, randomSeed, coarse } from './kit.js';
import { PALETTE_CB } from './index.js';
import { load, save } from './puzzlekit.js';
import {
  STEP, ROWS, GROUND, HALF, START_X, T, Runner, newRun, step as simStep, copyInto, copyRun, percent, hashRun, replay, stepsToFinish,
} from './pulserun-sim.js';
import { DEFS, mixDef, levelOf } from './pulserun-levels.js';
import { createMusic } from './pulserun-music.js';
import { mountEditor } from './pulserun-edit.js';
import { makeLevel } from './pulserun-sim.js';

const SHELL_KEYS = new Set(['Escape', 'KeyP', 'Enter', 'NumpadEnter', 'Tab']);
const JUMP_KEYS = new Set(['Space', 'ArrowUp', 'KeyW']);
const LEAD = 0.3;                         /* seconds from the press to the first step */
const PLAYER_X = 0.27;                    /* where on the screen the bead stays */
const MAXP = 80;                          /* particles */
const TRAIL = 10;
const CP_EVERY = 16;                      /* practice: a checkpoint every this many columns, when on the floor */
const WHY = { spike: 'hit a spike', wall: 'hit a wall', void: 'fell out of the course' };

const STD = { danger: '#ff5577', pad: '#ffd23f', ring: '#7be0ff', wind: '#8ff0c0', bead: '#fff4c2', beadFlip: '#bff6ff', ghost: '#9fb4ff' };
const CBP = { danger: PALETTE_CB[5], pad: PALETTE_CB[3], ring: PALETTE_CB[1], wind: PALETTE_CB[2], bead: '#ffffff', beadFlip: PALETTE_CB[1], ghost: PALETTE_CB[6] };

const cache = new Map();
const levelFor = def => { let L = cache.get(def.id); if (!L) { L = levelOf(def); cache.set(def.id, L); } return L; };

export default {
  mount(el, ctx = {}) {
    const reduced = !!ctx.reduced || document.body.classList.contains('reduce-motion');
    const seed = Number.isInteger(ctx.seed) ? ctx.seed >>> 0 : randomSeed();
    const oneButton = !!ctx.oneButton;
    const modeId = typeof ctx.mode === 'string' && (ctx.mode === 'mix' || ctx.mode === 'mine' || DEFS.some(d => d.id === ctx.mode)) ? ctx.mode : DEFS[0].id;
    const editing = modeId === 'mine';
    let sv = load('pulserun');
    const persist = patch => { save('pulserun', patch); sv = load('pulserun'); };
    const palette = () => (ctx.palette === 'cb' ? CBP : STD);

    /* ---------------- the level ---------------- */
    let def = null, L = null;
    const setLevel = (d, lv) => { def = d; L = lv; };
    if (modeId === 'mix') { const d = mixDef(seed); setLevel(d, levelOf(d)); }
    else if (editing) { const d = { id: 'mine', name: 'Your level', bpm: 120, hue: 200, song: { root: 55, mode: 'dorian', prog: [0, 3, 4, 0], lead: 1, arp: 1 }, bars: [] }; setLevel(d, null); }
    else { const d = DEFS.find(x => x.id === modeId); setLevel(d, levelFor(d)); }

    /* a ghost of your best run (a replay of this same level), or a replay to watch */
    const GH = ctx.ghost && ctx.ghost.data && ctx.ghost.data.v === 1 && Array.isArray(ctx.ghost.data.tog) && ctx.ghost.data.tog.length < 5000
      && ctx.ghost.data.tog.every((v, i, a) => Number.isInteger(v) && v >= 0 && (i === 0 || v > a[i - 1])) && (ctx.ghost.data.lv || modeId) === modeId ? ctx.ghost : null;
    const watch = !!(GH && GH.watch);

    /* ---------------- state ---------------- */
    const S = {
      state: editing ? 'edit' : 'ready', paused: false, starting: false, tok: 0, practice: false, attempt: 0, cps: [], nextCp: START_X + CP_EVERY, dieT: 0, endT: 0,
      px: START_X, py: GROUND - HALF, pdir: 1, rx: START_X, ry: GROUND - HALF, rdir: 1, alpha: 0, pct: 0, bestPct: 0, jumpsSeen: 0, time: 0, shake: 0, flash: 0,
      hidden: false, testing: false, proof: null, quality: 2, slow: 0, fast: 0, frames: 0, ms: 0, maxMs: 0, over: false, why: '',
    };
    S.practice = !!ctx.settings?.practice;
    const clk = { mode: 'none', t0: 0, fake: null, lastSim: 0 };
    let R = null, music = null;
    let bgGrad = null, ts = 30, oy = 0, camX = 0, vx = 0, vy = 0;
    const X = x => (x - camX) * ts + vx, Y = y => y * ts + oy + vy;
    let trailX = new Float32Array(TRAIL), trailY = new Float32Array(TRAIL), trailN = 0, trailAt = 0;
    const strs = { pct: -1, pctS: '0%', att: -1, attS: '', attP: '' };
    const HINT = coarse() ? 'Tap to start' : 'Space, click or tap to start';
    let col = null, colFor = '';
    const down = new Set();
    /* the ghost: its own run played from the same list of steps */
    let G = null;
    const mkGhost = () => (GH && !watch && L && !S.practice ? { run: newRun(), i: 0, held: false, tog: GH.data.tog, px: START_X, py: GROUND - HALF, rx: START_X, ry: GROUND - HALF, gone: false } : null);
    const sf = surface(el, 'Pulse Run', () => { sizeBg(); draw(); });
    ctx.onScore?.(0);

    /* ---------------- particles: a fixed pool ---------------- */
    const P = { x: new Float32Array(MAXP), y: new Float32Array(MAXP), vx: new Float32Array(MAXP), vy: new Float32Array(MAXP), life: new Float32Array(MAXP), hue: new Float32Array(MAXP), n: 0 };
    function burst(x, y, count, speed, hue) {
      if (reduced || S.quality < 1) return;
      for (let i = 0; i < count; i++) {
        const k = P.n < MAXP ? P.n++ : Math.floor(Math.random() * MAXP);
        const a = Math.random() * 6.283, s = speed * (0.3 + Math.random());
        P.x[k] = x; P.y[k] = y; P.vx[k] = Math.cos(a) * s; P.vy[k] = Math.sin(a) * s - speed * 0.3; P.life[k] = 0.5 + Math.random() * 0.5; P.hue[k] = hue + Math.random() * 40;
      }
    }
    function tickParticles(dt) {
      for (let i = 0; i < P.n; i++) {
        P.life[i] -= dt;
        if (P.life[i] <= 0) { const j = --P.n; P.x[i] = P.x[j]; P.y[i] = P.y[j]; P.vx[i] = P.vx[j]; P.vy[i] = P.vy[j]; P.life[i] = P.life[j]; P.hue[i] = P.hue[j]; i--; continue; }
        P.vy[i] += 22 * dt; P.x[i] += P.vx[i] * dt; P.y[i] += P.vy[i] * dt;
      }
    }

    /* ---------------- the clock ---------------- */
    const base = () => (clk.fake ? clk.fake.t : clk.mode === 'audio' && music ? music.now() - music.latency() : performance.now() / 1000);
    const nowSim = () => base() - clk.t0;
    function makeRunner() {
      R = new Runner(L);
      S.px = START_X; S.py = GROUND - HALF; S.pdir = 1; S.jumpsSeen = 0; S.cps = []; S.nextCp = START_X + CP_EVERY;
      G = mkGhost();
      trailN = 0;
    }
    function setLevelRows(rows, speed) {
      const lv = makeLevel(rows, speed, 'Your level');
      def = { ...def, bpm: speed * 15 };
      L = lv;
      music?.close();
      music = createMusic(ctx, def.song, L.speed);
      makeRunner();
    }
    if (L) { music = createMusic(ctx, def.song, L.speed); makeRunner(); }

    /* begin a run (or resume one from a checkpoint) at level time simT */
    async function begin(simT) {
      if (S.starting || S.over) return;
      S.starting = true;
      const tok = ++S.tok;
      let res = null;
      if (!clk.fake && L) res = await music.start(simT, LEAD);
      if (tok !== S.tok || S.over) return;
      S.starting = false;
      if (clk.fake) { clk.mode = 'fake'; clk.t0 = clk.fake.t - simT; }
      else if (res) { clk.mode = 'audio'; clk.t0 = res.t0; }
      else { clk.mode = 'wall'; clk.t0 = performance.now() / 1000 + LEAD - simT; }
      S.state = 'play';
      S.attempt++;
      if (!S.testing) persist({ att: { ...(sv.att || {}), [modeId]: ((sv.att || {})[modeId] || 0) + 1 } });
      if (watch) { const tg = GH.data.tog; for (let i = 0; i < tg.length; i++) R.q.push(tg[i], i % 2 === 0 ? 1 : 0); R.lastStep = tg.length ? tg[tg.length - 1] : -1; R.last = tg.length % 2 === 1; }
      draw();
    }

    /* ---------------- input ---------------- */
    const heldNow = () => down.size > 0;
    function onHeld(h) {
      if (S.paused || S.hidden || watch) return;
      if (S.state === 'ready') { if (h) begin(0); return; }
      if (S.state === 'play' && R) {
        R.input(h, nowSim());
        if (h) music?.blip(420, 0.04, 'triangle', 0.3);
      }
    }
    const setDown = (key, on) => {
      const had = heldNow();
      if (on) down.add(key); else down.delete(key);
      const has = heldNow();
      if (has !== had) onHeld(has);
    };
    const mineKey = e => {
      if (JUMP_KEYS.has(e.code)) return true;
      return oneButton && !SHELL_KEYS.has(e.code) && e.code !== 'KeyC' && e.code !== 'KeyT' && !/^(Shift|Control|Alt|Meta|CapsLock)/.test(e.code);
    };
    const onKeyDown = e => {
      if (S.state === 'edit' && !S.testing) return;
      if (!ownsKey(el, e)) return;
      if (e.code === 'KeyC' && !e.repeat) { e.preventDefault(); manualCp(); return; }
      if (e.code === 'KeyT' && !e.repeat && S.state === 'ready' && !watch && L) { e.preventDefault(); S.practice = !S.practice; G = mkGhost(); draw(); return; }
      if (!mineKey(e)) return;
      e.preventDefault();
      if (e.repeat) return;
      setDown('k' + e.code, true);
    };
    const onKeyUp = e => { if (down.has('k' + e.code)) { setDown('k' + e.code, false); } };
    const onDown = e => { if (e.button > 0 || (S.state === 'edit' && !S.testing)) return; e.preventDefault(); try { sf.cv.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ } setDown('p' + e.pointerId, true); };
    const onUp = e => { if (down.has('p' + e.pointerId)) setDown('p' + e.pointerId, false); };
    const onBlur = () => { for (const k of [...down]) down.delete(k); onHeld(false); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    sf.cv.addEventListener('pointerdown', onDown);
    sf.cv.addEventListener('pointerup', onUp);
    sf.cv.addEventListener('pointercancel', onUp);
    sf.cv.addEventListener('lostpointercapture', onUp);

    /* ---------------- practice checkpoints ---------------- */
    function snap() { return { r: copyRun(R.r), n: R.r.n, x: R.r.x }; }
    function manualCp() {
      if (S.state !== 'play' || !S.practice || !R || R.r.dead || R.r.won) return;
      S.cps.push(snap());
      music?.blip(880, 0.08, 'sine', 0.5, 1320);
    }
    function restoreFromCp() {
      const cp = S.cps.length ? S.cps[S.cps.length - 1] : null;
      makeRunner();
      if (cp) { copyInto(R.r, cp.r); R.r.held = 0; S.cps = []; S.cps.push(cp); S.nextCp = cp.x + CP_EVERY; S.px = cp.r.x; S.py = cp.r.y; S.pdir = cp.r.dir; }
      S.state = 'ready'; S.starting = false;
      begin(cp ? cp.n * STEP : 0);
    }

    /* ---------------- play ---------------- */
    function stepGhost() {
      const g = G;
      if (!g || g.gone) return;
      const r = g.run;
      if (r.dead || r.won) { g.gone = true; return; }
      g.px = r.x; g.py = r.y;
      while (g.i < g.tog.length && g.tog[g.i] <= r.n) { g.held = !g.held; g.i++; }
      simStep(r, L, g.held);
    }
    function simulate() {
      const r = R.r, t = nowSim();
      clk.lastSim = t;
      const target = Math.floor(t / STEP + 1e-9);
      let k = 0;
      while (r.n < target && !r.dead && !r.won && k < 2400) {
        S.px = r.x; S.py = r.y; S.pdir = r.dir;
        R.one(); stepGhost(); k++;
        if (S.practice && r.ground && !r.wind && r.x >= S.nextCp) { S.cps.push(snap()); S.nextCp = r.x + CP_EVERY; }
        if (r.jumps !== S.jumpsSeen) { S.jumpsSeen = r.jumps; if (!reduced && S.quality > 0) burst(r.x, r.y + r.dir * HALF, 4, 2.5, 190); }
      }
      if (k >= 2400) { if (clk.mode === 'wall') clk.t0 = base() - r.n * STEP; }
      S.alpha = clamp((t - r.n * STEP) / STEP, 0, 1);
      const pc = percent(r, L);
      if (pc !== S.pct) { S.pct = pc; ctx.onScore?.(pc); if (!S.practice && pc > S.bestPct) S.bestPct = pc; }
      if (r.dead) onDeath(); else if (r.won) onWin();
    }
    function onDeath() {
      S.state = 'dying'; S.dieT = 0; S.why = R.r.why;
      music?.stop(); music?.noise(0.3, 0.9, 300); music?.blip(190, 0.3, 'sawtooth', 0.8, 50);
      if (!reduced) { S.shake = 0.3; S.flash = 0.18; }
      burst(R.r.x, R.r.y, 36, 7, 340);
      S.rx = R.r.x; S.ry = R.r.y;
    }
    function onWin() {
      S.state = 'won'; S.endT = 0; S.pct = 100;
      music?.stop();
      [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => music?.blip(f, 0.25, 'triangle', 0.7), i * 90));
      burst(R.r.x, R.r.y, 50, 8, 60);
      ctx.onScore?.(100);
    }
    function finish() {
      if (S.over) return;
      S.over = true; S.state = 'over';
      draw();
      const r = R.r, pc = r.won ? 100 : percent(r, L);
      const att = (sv.att || {})[modeId] || S.attempt;
      persist({ best: { ...(sv.best || {}), [modeId]: Math.max(pc, (sv.best || {})[modeId] || 0) } });
      const detail = r.won ? `Finished ${def.name} in ${att} attempt${att === 1 ? '' : 's'}${S.practice ? ' in practice' : ''}.` : `You ${WHY[S.why] || 'crashed'} at ${pc} %.`;
      ctx.onEnd({
        score: pc, won: !!r.won, detail,
        assisted: S.practice ? 'Practice runs never change your best' : undefined,
        replay: watch ? undefined : { v: 1, lv: modeId, tog: R.toggles.slice() },
      });
    }

    /* the editor's "test play": the editor's level, from the start, until it is finished */
    function testPlay(rows, speed) {
      setLevelRows(rows, speed);
      S.testing = true; S.state = 'ready'; S.over = false; S.pct = 0; S.attempt = 0; S.practice = false;
      editor.setTesting(true);
      loop.start();
      draw();
    }
    function endTest(won) {
      S.testing = false; S.state = 'edit'; S.starting = false; S.tok++;
      music?.stop();
      for (const k of [...down]) down.delete(k);
      editor.setTesting(false, won ? R.toggles.slice() : null);
      draw();
    }

    function tickState(dt) {
      S.time += dt;
      if (S.shake > 0) S.shake = Math.max(0, S.shake - dt);
      if (S.flash > 0) S.flash = Math.max(0, S.flash - dt);
      if (S.state === 'dying') {
        S.dieT += dt;
        if (S.dieT > (S.practice || S.testing ? 0.45 : 0.9)) {
          if (S.testing) { S.state = 'ready'; makeRunner(); S.attempt = 0; }
          else if (S.practice) restoreFromCp();
          else finish();
        }
      } else if (S.state === 'won') {
        S.endT += dt;
        if (S.endT > 1.1) { if (S.testing) endTest(true); else finish(); }
      } else if (S.state === 'ready' && watch && !S.starting) {
        S.endT += dt;
        if (S.endT > 0.7) begin(0);
      }
    }

    /* ---------------- the loop ---------------- */
    function frame(raw, noDraw) {
      const t0 = performance.now();
      if (S.state === 'play' && R) simulate();
      tickState(raw);
      tickParticles(raw);
      if (!noDraw) draw();
      S.frames++;
      const ms = performance.now() - t0;
      S.ms += ms; if (ms > S.maxMs) S.maxMs = ms;
      governor(raw * 1000, ms);
    }
    /* a slow device: when frames run long, draw less (never touches the rules) */
    let avg = 16;
    function governor(wallMs, ms) {
      if (clk.fake) return;
      avg = avg * 0.9 + wallMs * 0.1;
      if (avg > 26 && S.quality > 0) { S.slow++; S.fast = 0; if (S.slow > 20) { S.quality--; S.slow = 0; avg = 16; } }
      else if (avg < 19 && S.quality < 2) { S.fast++; S.slow = 0; if (S.fast > 400) { S.quality++; S.fast = 0; } }
      else { S.slow = Math.max(0, S.slow - 1); }
    }
    const loop = looper(raw => { frame(raw); if (S.over) loop.stop(); });

    /* ---------------- drawing ---------------- */
    function sizeBg() { bgGrad = null; }
    function colors(pal) {
      const h = def ? def.hue : 200;
      return {
        top: `hsl(${h},42%,9%)`, bot: `hsl(${(h + 35) % 360},46%,19%)`, bar: `hsl(${h},70%,60%)`, block: `hsl(${h},30%,24%)`, edge: `hsl(${h},75%,64%)`, deep: `hsl(${h},30%,17%)`, grid: `hsla(${h},50%,70%,.07)`, pal,
      };
    }
    function draw() {
      const g = sf.g;
      sf.begin();
      const W = sf.w, H = sf.h;
      const pal = palette();
      const key = `${def?.hue}|${pal === CBP}`;
      if (!col || colFor !== key) { col = colors(pal); colFor = key; bgGrad = null; }
      if (!bgGrad) { bgGrad = g.createLinearGradient(0, 0, 0, H); bgGrad.addColorStop(0, col.top); bgGrad.addColorStop(1, col.bot); }
      g.fillStyle = bgGrad;
      g.fillRect(0, 0, W, H);
      if (S.state === 'edit' && !S.testing) return;
      if (!L) return;
      ts = Math.min(H / ROWS, W / 14);
      oy = (H - ts * ROWS) / 2;
      /* where everything is drawn: one step behind the rules, blended by the time since the last step */
      const a = S.state === 'play' ? S.alpha : 1;
      const r = R.r;
      let rx, ry;
      if (S.state === 'play') { rx = S.px + (r.x - S.px) * a; ry = S.py + (r.y - S.py) * a; } else { rx = r.x; ry = r.y; }
      S.rx = rx; S.ry = ry; S.rdir = r.dir;
      camX = rx - (W / ts) * PLAYER_X;
      const sx0 = S.shake > 0 && !reduced ? (Math.random() - 0.5) * S.shake * 22 : 0, sy0 = S.shake > 0 && !reduced ? (Math.random() - 0.5) * S.shake * 22 : 0;
      vx = sx0; vy = sy0;
      /* the pulse of the beat: a glow that closes on every beat, and the bars of the backdrop */
      const beat = (S.state === 'play' || S.state === 'won' ? clk.lastSim : S.time) * (L.bpm / 60);
      const ph = beat - Math.floor(beat);
      if (S.quality > 0) {
        const bars = S.quality > 1 ? 28 : 14, bw = W / bars, pulse = reduced ? 0.4 : 1 - ph;
        g.fillStyle = col.bar;
        for (let i = 0; i < bars; i++) {
          const wob = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(i * 1.7 + Math.floor(beat) * 0.9);
          const h = H * (0.1 + 0.28 * wob * (0.35 + 0.65 * pulse));
          g.globalAlpha = 0.1 + 0.1 * pulse;
          g.fillRect(i * bw + 2 - ((camX * ts * 0.15) % bw) + bw, H - h, bw - 4, h);
        }
        g.globalAlpha = 1;
      }
      /* the tiles that are on screen */
      const c0 = Math.max(0, Math.floor(camX) - 1), c1 = Math.min(L.cols - 1, Math.ceil(camX + W / ts) + 1), cols = L.cols, gd = L.g;
      if (S.quality > 1) { g.fillStyle = col.grid; for (let c = c0; c <= c1; c++) g.fillRect(X(c), oy, 1, ts * ROWS); }
      /* solid blocks and wind, a whole run of equal tiles at a time (few draw calls: a long floor is one rectangle a row) */
      const eT = Math.max(2, ts * 0.09);
      for (let rr = 0; rr < ROWS; rr++) {
        const y = Y(rr), base = rr * cols, upBase = base - cols, dnBase = base + cols;
        let c = c0;
        while (c <= c1) {
          const k = gd[base + c];
          if (k === T.B) {
            const up = rr > 0 && gd[upBase + c] === T.B, dn = rr < ROWS - 1 ? gd[dnBase + c] === T.B : true;
            let d = c + 1;
            while (d <= c1 && gd[base + d] === T.B && (rr > 0 && gd[upBase + d] === T.B) === up && (rr < ROWS - 1 ? gd[dnBase + d] === T.B : true) === dn) d++;
            const x = X(c), w = (d - c) * ts + 1;
            g.fillStyle = rr > GROUND ? col.deep : col.block; g.fillRect(x, y, w, ts + 1);
            if (!up || (!dn && rr < ROWS - 1)) { g.fillStyle = col.edge; if (!up) g.fillRect(x, y, w, eT); if (!dn && rr < ROWS - 1) g.fillRect(x, y + ts - eT, w, eT); }
            c = d;
          } else if (k === T.WIND) {
            let d = c + 1;
            while (d <= c1 && gd[base + d] === T.WIND) d++;
            g.fillStyle = pal.wind; g.globalAlpha = 0.1; g.fillRect(X(c), y, (d - c) * ts + 1, ts + 1);
            g.globalAlpha = 0.55;
            for (let q = c; q < d; q++) { const o = reduced ? 0.3 : ((S.time * 1.6 + q * 0.37 + rr * 0.21) % 1); g.fillRect(X(q) + ts * 0.1, y + ts * (0.15 + 0.7 * o), ts * 0.8, Math.max(1.5, ts * 0.05)); }
            g.globalAlpha = 1;
            c = d;
          } else c++;
        }
      }
      /* the things that are not a block: spikes, pads, gate rings */
      for (let c = c0; c <= c1; c++) {
        const x = X(c);
        for (let rr = 0; rr < ROWS; rr++) {
          const k = gd[rr * cols + c];
          if (k < T.UP || k === T.WIND) continue;
          const y = Y(rr);
          if (k === T.UP || k === T.DN) {
            const up = k === T.UP;
            g.fillStyle = pal.danger;
            if (S.quality > 1) { g.globalAlpha = 0.22; g.beginPath(); if (up) { g.moveTo(x - ts * 0.08, y + ts); g.lineTo(x + ts * 0.5, y - ts * 0.04); g.lineTo(x + ts * 1.08, y + ts); } else { g.moveTo(x - ts * 0.08, y); g.lineTo(x + ts * 0.5, y + ts * 1.04); g.lineTo(x + ts * 1.08, y); } g.closePath(); g.fill(); g.globalAlpha = 1; }
            g.beginPath();
            if (up) { g.moveTo(x + ts * 0.06, y + ts); g.lineTo(x + ts * 0.5, y + ts * 0.14); g.lineTo(x + ts * 0.94, y + ts); } else { g.moveTo(x + ts * 0.06, y); g.lineTo(x + ts * 0.5, y + ts * 0.86); g.lineTo(x + ts * 0.94, y); }
            g.closePath(); g.fill();
            if (pal === CBP) { g.strokeStyle = '#fff'; g.lineWidth = Math.max(1.5, ts * 0.05); g.stroke(); }
          } else if (k === T.PAD) {
            const low = rr >= ROWS / 2;
            g.fillStyle = pal.pad;
            g.fillRect(x + ts * 0.1, low ? y + ts * 0.72 : y, ts * 0.8, ts * 0.28);
            g.fillRect(x + ts * 0.25, low ? y + ts * 0.56 : y + ts * 0.28, ts * 0.5, ts * 0.16);
          } else if (k === T.RING) {
            g.strokeStyle = pal.ring; g.lineWidth = Math.max(2, ts * 0.07);
            g.globalAlpha = 0.75;
            g.beginPath(); g.arc(x + ts / 2, y + ts / 2, ts * 0.34, 0, 6.283); g.stroke();
            g.globalAlpha = 0.14; g.fillStyle = pal.ring; g.fillRect(x, y, ts + 1, ts + 1);
            g.globalAlpha = 1;
          }
        }
      }
      /* the finish line */
      const fx = X(L.finish);
      if (fx > -ts && fx < W + ts) { g.fillStyle = pal.pad; g.globalAlpha = 0.85; g.fillRect(fx, oy, Math.max(3, ts * 0.12), ts * ROWS); g.globalAlpha = 1; }
      /* practice checkpoints */
      if (S.practice) for (let i = 0; i < S.cps.length; i++) { const cx = X(S.cps[i].x); if (cx < -ts || cx > W + ts) continue; g.fillStyle = pal.ring; g.fillRect(cx, Y(S.cps[i].r.y) - ts * 0.9, Math.max(2, ts * 0.06), ts * 0.9); g.fillRect(cx, Y(S.cps[i].r.y) - ts * 0.9, ts * 0.4, ts * 0.26); }
      /* the ghost of your best run */
      if (G && !G.gone) {
        const gr = G.run, gx = G.px + (gr.x - G.px) * a, gy = G.py + (gr.y - G.py) * a;
        g.globalAlpha = 0.4; g.fillStyle = pal.ghost;
        g.beginPath(); g.arc(X(gx), Y(gy), ts * 0.42, 0, 6.283); g.fill(); g.globalAlpha = 1;
      }
      /* the bead and its trail */
      if (S.state !== 'dying' && S.state !== 'over') {
        if (!reduced && S.quality > 1 && S.state === 'play') {
          const tNow = clk.lastSim;
          if (tNow - trailAt > 0.018) { trailAt = tNow; if (trailN < TRAIL) trailN++; for (let i = trailN - 1; i > 0; i--) { trailX[i] = trailX[i - 1]; trailY[i] = trailY[i - 1]; } trailX[0] = rx; trailY[0] = ry; }
          g.fillStyle = r.dir > 0 ? pal.bead : pal.beadFlip;
          for (let i = 1; i < trailN; i++) { g.globalAlpha = 0.26 * (1 - i / trailN); g.beginPath(); g.arc(X(trailX[i]), Y(trailY[i]), ts * 0.4 * (1 - i / (trailN + 2)), 0, 6.283); g.fill(); }
          g.globalAlpha = 1;
        }
        const bx = X(rx), by = Y(ry), rad = ts * 0.44;
        g.globalAlpha = 0.25; g.fillStyle = r.dir > 0 ? pal.bead : pal.beadFlip; g.beginPath(); g.arc(bx, by, rad * 1.45, 0, 6.283); g.fill(); g.globalAlpha = 1;
        g.fillStyle = r.dir > 0 ? pal.bead : pal.beadFlip; g.beginPath(); g.arc(bx, by, rad, 0, 6.283); g.fill();
        const rot = reduced ? 0 : rx * 2.4;
        g.strokeStyle = '#10131c'; g.lineWidth = Math.max(2, ts * 0.07);
        g.beginPath(); g.moveTo(bx - Math.cos(rot) * rad * 0.62, by - Math.sin(rot) * rad * 0.62); g.lineTo(bx + Math.cos(rot) * rad * 0.62, by + Math.sin(rot) * rad * 0.62); g.stroke();
        g.beginPath(); g.arc(bx, by, rad * 0.2, 0, 6.283); g.stroke();
      }
      /* particles */
      if (P.n) {
        g.fillStyle = pal.pad;
        for (let i = 0; i < P.n; i++) { g.globalAlpha = Math.min(1, P.life[i] * 2); g.fillRect(X(P.x[i]), Y(P.y[i]), ts * 0.12, ts * 0.12); }
        g.globalAlpha = 1;
      }
      if (S.flash > 0 && !reduced) { g.fillStyle = pal.danger; g.globalAlpha = S.flash * 1.2; g.fillRect(0, 0, W, H); g.globalAlpha = 1; }
      hud(g, W, H, pal);
      if (S.state === 'ready') {
        if (watch) prompt(g, sf, 'Watching your best run', '', def.hue);
        else prompt(g, sf, S.starting ? 'Starting…' : HINT, S.practice ? 'practice: checkpoints on · C marks one' : 'hold to jump · T turns practice on', def.hue, H * 0.62);
      }
      if (S.paused) prompt(g, sf, 'Paused', '', def.hue);
    }
    function hud(g, W, H, pal) {
      const k = Math.max(0.8, Math.min(1.2, W / 520));
      const bw = Math.min(W - 24, 520), bx = (W - bw) / 2, by = 12 * k;
      g.fillStyle = 'rgba(4,6,10,.62)'; g.fillRect(bx - 4, by - 4, bw + 8, 14 * k + 8);
      g.fillStyle = 'rgba(255,255,255,.14)'; g.fillRect(bx, by, bw, 14 * k);
      g.fillStyle = col.bar; g.fillRect(bx, by, bw * S.pct / 100, 14 * k);
      const best = Math.max(S.bestPct, S.practice ? 0 : ctx.best || 0, (sv.best || {})[modeId] || 0);
      if (best > 0 && best < 100) { g.fillStyle = '#fff'; g.fillRect(bx + bw * best / 100 - 1, by - 2, 2, 14 * k + 4); }
      if (strs.pct !== S.pct) { strs.pct = S.pct; strs.pctS = `${S.pct}%`; }
      const att = S.testing ? S.attempt : (sv.att || {})[modeId] || S.attempt;
      if (strs.att !== att) { strs.att = att; strs.attS = att ? `Attempt ${att}` : ''; strs.attP = `Practice · ${strs.attS}`; }
      g.textBaseline = 'top'; g.font = `800 ${Math.round(15 * k)}px ${FONT}`;
      g.textAlign = 'left'; g.fillStyle = '#f4f7f5'; g.fillText(def.name, bx, by + 22 * k);
      g.textAlign = 'center'; g.fillText(strs.pctS, W / 2, by + 22 * k);
      g.textAlign = 'right'; g.font = `600 ${Math.round(13 * k)}px ${FONT}`; g.fillStyle = 'rgba(255,255,255,.75)';
      g.fillText(S.practice ? strs.attP : strs.attS, bx + bw, by + 23 * k);
      if (S.quality < 2 && S.state === 'ready') { g.textAlign = 'left'; g.fillStyle = 'rgba(255,255,255,.45)'; g.fillText('simple scenery', bx, by + 42 * k); }
      if (clk.mode === 'wall' && S.state !== 'ready') { g.textAlign = 'left'; g.fillStyle = 'rgba(255,255,255,.5)'; g.fillText('no sound clock: keeping time without music', bx, by + 42 * k); }
    }

    /* ---------------- the editor ---------------- */
    const editor = mountEditor(el, ctx, {
      active: editing,
      save: patch => persist(patch),
      saved: () => sv,
      test: (rows, speed) => testPlay(rows, speed),
      back: () => { if (S.testing) endTest(false); },
      reduced,
    });

    loop.start();
    if (watch) S.state = 'ready';

    /* ---------------- teardown, pause ---------------- */
    const onVis = () => {
      if (document.hidden) { if (!S.paused && S.state === 'play') { S.hidden = true; hold(); } }
      else if (S.hidden) { S.hidden = false; if (!S.paused) release(); }
    };
    document.addEventListener('visibilitychange', onVis);
    let pausedAt = 0;
    function hold() {
      pausedAt = performance.now();
      loop.stop();
      music?.suspend();
      if (S.state === 'play') for (const k of [...down]) down.delete(k);
    }
    async function release() {
      if (S.over) return;
      if (clk.mode === 'wall') clk.t0 += (performance.now() - pausedAt) / 1000;
      else if (clk.mode === 'audio' && S.state === 'play' && music) {
        const ok = await music.resume();
        if (!ok) { clk.mode = 'wall'; clk.t0 = performance.now() / 1000 - clk.lastSim; }
      }
      loop.start();
    }
    return {
      stop() {
        loop.stop(); S.tok++;
        window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('blur', onBlur);
        document.removeEventListener('visibilitychange', onVis);
        sf.cv.removeEventListener('pointerdown', onDown); sf.cv.removeEventListener('pointerup', onUp); sf.cv.removeEventListener('pointercancel', onUp); sf.cv.removeEventListener('lostpointercapture', onUp);
        music?.close(); editor.destroy(); sf.destroy();
      },
      pause() { S.paused = true; hold(); draw(); },
      resume() { S.paused = false; if (!S.hidden) release(); },
      peek: () => ({
        state: S.state, paused: S.paused, mode: modeId, level: def?.name, seed, watch, practice: S.practice, oneButton, attempt: S.attempt, pct: S.pct, bestPct: S.bestPct,
        n: R?.r.n ?? 0, x: R?.r.x ?? 0, y: R?.r.y ?? 0, vy: R?.r.vy ?? 0, dir: R?.r.dir ?? 1, ground: R?.r.ground ?? 0, dead: R?.r.dead ?? 0, won: R?.r.won ?? 0, why: R?.r.why ?? '',
        held: R ? R.last : false, toggles: R ? R.toggles.slice() : [], cps: S.cps.length, hash: R ? hashRun(R.r) : 0, cols: L?.cols ?? 0, speed: L?.speed ?? 0, bpm: L?.bpm ?? 0,
        clock: { mode: clk.mode, t0: clk.t0, base: clk.mode === 'none' ? 0 : base(), sim: clk.lastSim, audio: music ? music.now() : 0, running: !!music?.running, ahead: music ? music.ahead() : 0, latency: music ? music.latency() : 0 },
        ghost: G ? { x: G.run.x, gone: G.gone, n: G.run.n, dead: G.run.dead, why: G.run.why, i: G.i, tog: G.tog.length } : null, quality: S.quality, particles: P.n, testing: S.testing,
        perf: { frames: S.frames, avgMs: S.frames ? S.ms / S.frames : 0, maxMs: S.maxMs }, editor: editor.peek(), reduced, cb: ctx.palette === 'cb',
      }),
      hook(cmd, a) {
        if (cmd === 'clock') { clk.fake = a ? { t: a.t || 0 } : null; if (!a) clk.mode = 'none'; return true; }
        if (cmd === 'advance') {
          if (!clk.fake) return false;
          const to = a.to, fps = a.fps || 60;
          while (clk.fake.t < to - 1e-9) { clk.fake.t = Math.min(to, clk.fake.t + 1 / fps); frame(1 / fps, false); }
          return true;
        }
        if (cmd === 'bench') {
          /* the cost of a frame: n frames of the real frame function (steps, particles and a full draw) on a made-up clock */
          const prevFake = clk.fake;
          if (S.state === 'ready') { clk.fake = { t: 0 }; begin(0); }
          return new Promise(resolve => setTimeout(async () => {
            const n = a.frames || 300, ms = [];
            const heap0 = performance.memory ? performance.memory.usedJSHeapSize : 0;
            for (let i = 0; i < n; i++) {
              if (S.state === 'dying' || S.state === 'over' || S.state === 'won' || R.r.dead) { makeRunner(); S.state = 'play'; clk.t0 = clk.fake.t; }
              clk.fake.t += 1 / 60;
              /* a hold every so often keeps the bead moving about */
              if (i % 25 === 0) R.input(true, clk.fake.t); if (i % 25 === 8) R.input(false, clk.fake.t);
              const t0 = performance.now(); frame(1 / 60, a.draw === false); ms.push(performance.now() - t0); await new Promise(r => requestAnimationFrame(r));
            }
            const first = ms.slice(0, 4), at = ms.indexOf(Math.max(...ms));
            ms.sort((x, y) => x - y);
            const heap1 = performance.memory ? performance.memory.usedJSHeapSize : 0;
            clk.fake = prevFake;
            resolve({ frames: n, avg: ms.reduce((s, v) => s + v, 0) / n, p95: ms[Math.floor(n * 0.95)], max: ms[n - 1], heap: heap1 - heap0, first, at });
          }, 0));
        }
        if (cmd === 'drive') {
          /* the real frame loop on a made-up clock at a chosen frame rate, with button changes at exact times:
             { fps, jitter?, events: [{ t, held }], seconds } → the run's hash and numbers */
          clk.fake = { t: 0 };
          if (S.state !== 'ready') { makeRunner(); S.state = 'ready'; S.over = false; S.starting = false; }
          begin(0);
          return new Promise(resolve => setTimeout(() => {
            const ev = a.events.slice().sort((p, q) => p.t - q.t);
            let i = 0, t = 0, f = 0;
            const dts = a.jitter ? a.jitter.map(v => v / 1000) : [1 / a.fps];
            const end = a.seconds;
            while (t < end && !R.r.dead && !R.r.won) {
              const nt = Math.min(end, t + dts[f++ % dts.length]);
              while (i < ev.length && ev[i].t <= nt) { clk.fake.t = ev[i].t; onHeld(ev[i].held); i++; }
              clk.fake.t = nt; t = nt;
              frame(1 / a.fps, false);
            }
            resolve({ hash: hashRun(R.r), n: R.r.n, x: R.r.x, y: R.r.y, dead: R.r.dead, won: R.r.won, toggles: R.toggles.slice(), frames: f });
          }, 0));
        }
        if (cmd === 'level') return L ? { rows: L.rows, speed: L.speed, cols: L.cols, finish: L.finish } : null;
        return undefined;
      },
    };
  },
};
