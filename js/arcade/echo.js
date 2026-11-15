/* ============================================================
   arcade/echo.js — Echo: repeat the pattern of lights and tones.

   Four pads, each with its own colour, key and note — E4, A4, C♯5,
   E5, an A-major spread, so every pair of pads sounds clearly
   different. The pads sit top / right / bottom / left like a D-pad,
   numbered clockwise, so 1–4 and the arrow keys (↑ → ↓ ←) both play
   them — and so does a controller's D-pad through the Arcade's
   controller bridge (core/padmap.js), whose A / Start (Space / Enter)
   also press Start. Each round Echo plays the sequence so far plus
   one new step; you play it back by tapping/clicking the pads or with
   the keys. There is no time limit on your answer. A wrong pad ends
   the game and lights the pad that was due. Score = the longest
   sequence you repeated correctly.

   Playback speeds up a little as the sequence grows (it never gets
   faster than ~4 steps a second). Pauses throw the current playback
   away and play the whole round again on resume, so a pause never
   costs you a step.

   Sound is synthesised with WebAudio: the AudioContext is created on
   the Start click (browsers only allow audio after a gesture), obeys
   StaticOS's Mute and Volume, and is closed in stop(). When sound is
   muted or unavailable the game still works from the lights alone,
   and the start screen says so.

   Modes (ctx.mode, each with its own best):
     Classic  one wrong pad ends the game; no time limit.
     Strict   one wrong pad ends it, and each step must come within
              STRICT_MS of the last (twice that in one-button mode,
              where the ring needs time to come round).
     Free     a wrong pad costs one of three tries and the round is
              played again; the third miss ends the game.

   Shapes: each pad can carry a shape as well as its colour — a
   triangle, a circle, a square and a diamond — so the pads can be
   told apart without colour. They are on with the Arcade's
   colour-blind colours (ctx.palette 'cb', which also swaps the pads
   to that set) or with the game's own "Shapes on the pads" setting.

   One-button mode (ctx.oneButton, from the Arcade's options) is
   switch scanning: on your turn a white ring moves from pad to pad,
   clockwise from the top, one pad every SCAN_MS; press the one
   button — Space, Enter, a click or a tap anywhere on the game —
   while the ring is on the pad you want. After each press the ring
   starts again at the top. It never times out: the ring keeps going
   round until you choose. The number keys and arrows still work.
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { store } from '../core/store.js';
import { PALETTE_CB } from './index.js';

/* clockwise from the top; `arrow` is the key that also plays the pad; `cb` its colour-blind colour */
const PADS = [
  { name: 'green', where: 'top', color: '#22c55e', cb: PALETTE_CB[2], shape: 'triangle', hz: 329.63, arrow: 'ArrowUp', glyph: '↑' },
  { name: 'red', where: 'right', color: '#f43f5e', cb: PALETTE_CB[5], shape: 'circle', hz: 440.0, arrow: 'ArrowRight', glyph: '→' },
  { name: 'yellow', where: 'bottom', color: '#facc15', cb: PALETTE_CB[3], shape: 'square', hz: 554.37, arrow: 'ArrowDown', glyph: '↓' },
  { name: 'blue', where: 'left', color: '#3b82f6', cb: PALETTE_CB[4], shape: 'diamond', hz: 659.25, arrow: 'ArrowLeft', glyph: '←' },
];
/* each shape as an SVG path in a 24 × 24 box, drawn upright on its pad */
const SHAPES = {
  triangle: 'M12 3 L22 20 H2 Z',
  circle: 'M12 3 a9 9 0 1 0 0.01 0 Z',
  square: 'M4 4 H20 V20 H4 Z',
  diamond: 'M12 2 L22 12 L12 22 L2 12 Z',
};
const PRESS_MS = 230;
const SCAN_MS = 1100;             /* one-button mode: how long the ring stays on each pad */
const STRICT_MS = 3000;           /* Strict: the most a step may take */
const TRIES = 3;                  /* Free: misses before the game ends */

const CSS = `
.arx-echo{position:relative;width:100%;height:100%;min-height:340px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--sp-4,12px);
  padding:var(--sp-5,16px);box-sizing:border-box;font-family:var(--font,system-ui);color:var(--ink-1,#eee);container-type:size;user-select:none;-webkit-user-select:none}
.arx-echo *{box-sizing:border-box}
.arx-echo__disc{--size:min(100cqw - 32px,100cqh - 70px,560px);position:relative;flex:0 0 auto;width:var(--size);height:var(--size);border-radius:50%;
  background:radial-gradient(circle at 50% 35%,var(--fill-2,rgba(255,255,255,.1)),var(--fill-0,rgba(255,255,255,.03)));border:1px solid var(--line-1,rgba(255,255,255,.08));
  box-shadow:0 30px 60px -30px rgba(0,0,0,.8),inset 0 1px 0 rgba(255,255,255,.06)}
/* a 2×2 grid of quarter-discs turned 45°: the pads sit top, right, bottom, left */
.arx-echo__ring{position:absolute;inset:calc(var(--size) * .035);display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:calc(var(--size) * .03);transform:rotate(45deg)}
.arx-echo__pad{--pc:#888;position:relative;border:0;padding:0;cursor:pointer;outline:none;-webkit-tap-highlight-color:transparent;touch-action:manipulation;
  background:radial-gradient(circle at var(--gx) var(--gy),color-mix(in srgb,var(--pc) 58%,#000),color-mix(in srgb,var(--pc) 30%,#000));
  box-shadow:inset 0 1px 0 rgba(255,255,255,.12),inset 0 -8px 20px rgba(0,0,0,.35);transition:filter .08s,box-shadow .08s,background .08s}
.arx-echo__pad[data-p="0"]{grid-area:1/1;border-radius:100% 10px 10px 10px;--gx:80%;--gy:80%}
.arx-echo__pad[data-p="1"]{grid-area:1/2;border-radius:10px 100% 10px 10px;--gx:20%;--gy:80%}
.arx-echo__pad[data-p="2"]{grid-area:2/2;border-radius:10px 10px 100% 10px;--gx:20%;--gy:20%}
.arx-echo__pad[data-p="3"]{grid-area:2/1;border-radius:10px 10px 10px 100%;--gx:80%;--gy:20%}
.arx-echo__pad.is-lit,.arx-echo__pad.is-due{background:radial-gradient(circle at var(--gx) var(--gy),color-mix(in srgb,var(--pc) 70%,#fff),var(--pc));
  box-shadow:0 0 calc(var(--size) * .09) color-mix(in srgb,var(--pc) 75%,transparent),inset 0 1px 0 rgba(255,255,255,.4);filter:saturate(1.15)}
.arx-echo__pad.is-due{animation:arx-echo-due .5s steps(1) 3}
@keyframes arx-echo-due{50%{filter:brightness(.4) saturate(.8)}}
.arx-echo.is-reduced .arx-echo__pad.is-due{animation:none}
.arx-echo__pad.is-scan::after{content:"";position:absolute;inset:6%;border-radius:inherit;border:calc(var(--size) * .014) solid #fff;box-shadow:0 0 0 calc(var(--size) * .006) #000,inset 0 0 0 calc(var(--size) * .006) #000;pointer-events:none}
.arx-echo__pad:focus-visible{outline:none;box-shadow:0 0 0 3px var(--ink-0,#fff),inset 0 1px 0 rgba(255,255,255,.12)}
.arx-echo.is-watch .arx-echo__pad,.arx-echo.is-over .arx-echo__pad,.arx-echo.is-intro .arx-echo__pad{cursor:default}
.arx-echo.is-reduced .arx-echo__pad{transition:none}
.arx-echo__key{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(-45deg);display:inline-flex;align-items:center;gap:.4em;white-space:nowrap;
  font:700 max(11px,calc(var(--size) * .03))/1 var(--mono,ui-monospace,monospace);color:rgba(255,255,255,.8);
  padding:.35em .55em;border-radius:6px;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.14);pointer-events:none}
.arx-echo__key i{font-style:normal;font-weight:600;opacity:.62}
.arx-echo__pad.is-lit .arx-echo__key,.arx-echo__pad.is-due .arx-echo__key{color:rgba(0,0,0,.72);background:rgba(255,255,255,.35);border-color:rgba(0,0,0,.14)}
.arx-echo__shape{position:absolute;left:50%;top:50%;width:calc(var(--size) * .1);height:calc(var(--size) * .1);transform:translate(-50%,-50%) rotate(-45deg);pointer-events:none;display:none}
.arx-echo__shape path{fill:rgba(255,255,255,.88);stroke:rgba(0,0,0,.55);stroke-width:1.6;stroke-linejoin:round}
.arx-echo__pad.is-lit .arx-echo__shape path,.arx-echo__pad.is-due .arx-echo__shape path{fill:rgba(0,0,0,.72);stroke:rgba(255,255,255,.6)}
.arx-echo.has-shapes .arx-echo__shape{display:block}
/* with a shape on the pad: the key label towards the rim, the shape towards the hub */
.arx-echo.has-shapes .arx-echo__pad[data-p="0"] .arx-echo__key{left:38%;top:38%}
.arx-echo.has-shapes .arx-echo__pad[data-p="0"] .arx-echo__shape{left:60%;top:60%}
.arx-echo.has-shapes .arx-echo__pad[data-p="1"] .arx-echo__key{left:62%;top:38%}
.arx-echo.has-shapes .arx-echo__pad[data-p="1"] .arx-echo__shape{left:40%;top:60%}
.arx-echo.has-shapes .arx-echo__pad[data-p="2"] .arx-echo__key{left:62%;top:62%}
.arx-echo.has-shapes .arx-echo__pad[data-p="2"] .arx-echo__shape{left:40%;top:40%}
.arx-echo.has-shapes .arx-echo__pad[data-p="3"] .arx-echo__key{left:38%;top:62%}
.arx-echo.has-shapes .arx-echo__pad[data-p="3"] .arx-echo__shape{left:60%;top:40%}
.arx-echo__tries{display:flex;gap:4px;justify-content:center}
.arx-echo__tries i{width:calc(var(--size) * .016);height:calc(var(--size) * .016);border-radius:50%;background:var(--ga)}
.arx-echo__tries i.is-gone{background:rgba(255,255,255,.18)}
.arx-echo__hub{position:absolute;left:50%;top:50%;width:40%;height:40%;transform:translate(-50%,-50%);border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:calc(var(--size) * .008);text-align:center;background:radial-gradient(circle at 50% 30%,#2a1a24,#0c070a),#0c070a;color:#fff;
  border:calc(var(--size) * .018) solid #150b11;box-shadow:0 10px 30px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.06);padding:6%}
.arx-echo__kick{margin-bottom:calc(var(--size) * .006);font-size:calc(var(--size) * .024);letter-spacing:.14em;text-transform:uppercase;font-weight:700;color:rgba(255,255,255,.5)}
.arx-echo__num{font-size:calc(var(--size) * .1);font-weight:800;letter-spacing:-.04em;line-height:1;color:#fff;font-variant-numeric:tabular-nums}
.arx-echo__msg{font-size:calc(var(--size) * .03);font-weight:600;color:var(--ga)}
.arx-echo__msg.is-bad{color:#f87171}
.arx-echo__start{font:700 calc(var(--size) * .036)/1 var(--font,system-ui);color:var(--accent-ink,#fff);background:var(--ga);border:0;border-radius:99px;
  padding:.8em 1.5em;cursor:pointer;display:inline-flex;align-items:center;gap:.45em;box-shadow:0 8px 24px -8px var(--ga)}
.arx-echo__start .icon{width:1.1em;height:1.1em}
.arx-echo__start:focus-visible{outline:3px solid #fff;outline-offset:3px}
.arx-echo__foot{font-size:var(--fs-12,12px);color:var(--ink-3,#888);text-align:center;min-height:18px}
.arx-echo__foot kbd{font:600 calc(11px * var(--fs-k,1))/1 var(--mono,ui-monospace,monospace);padding:3px 6px;border-radius:5px;border:1px solid var(--line-2,rgba(255,255,255,.14));border-bottom-width:2px;background:var(--fill-1,rgba(255,255,255,.05));color:var(--ink-1,#ddd)}
.arx-echo__foot.is-warn{color:#f59e0b}
@container (max-width:420px){.arx-echo{padding:var(--sp-3,8px)}.arx-echo__disc{--size:min(100cqw - 16px,100cqh - 60px,560px)}}
`;

export default {
  mount(el, ctx = {}) {
    const onScore = typeof ctx.onScore === 'function' ? ctx.onScore : () => {};
    const onEnd = typeof ctx.onEnd === 'function' ? ctx.onEnd : () => {};

    let dead = false, paused = false;
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    let state = 'intro';             // intro | watch | input | over
    const seq = [];
    let pos = 0;
    let longest = 0;
    let cleared = false;             // this round was repeated; the next step is on its way
    const one = !!ctx.oneButton;
    const MODE = ['strict', 'free'].includes(ctx.mode) ? ctx.mode : 'classic';
    const stepMs = one ? STRICT_MS * 2 : STRICT_MS;
    let tries = TRIES;               // Free: misses left
    let misses = 0;
    let stepT = 0;                   // Strict: the timer on the step that is due
    let scan = -1, scanT = 0;        // one-button mode: the pad the ring is on, and its timer
    let ac = null, master = null;
    const timers = new Set();
    const offs = [];
    const listen = (t, type, fn, opts) => { t.addEventListener(type, fn, opts); offs.push(() => t.removeEventListener(type, fn, opts)); };
    const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); if (!dead) fn(); }, ms); timers.add(id); return id; };
    const clearAll = () => { timers.forEach(clearTimeout); timers.clear(); };

    /* ---- sound ---- */
    /* the Arcade passes its own sound switch (which already folds in the
       OS mute) and the OS volume; standalone, read the prefs directly */
    const muted = () => ('sound' in ctx ? !ctx.sound : false) || store.get('prefs.muted', false) === true;
    const volume = () => {
      const v = typeof ctx.volume === 'number' ? ctx.volume : (Number(store.get('prefs.volume', 62)) || 0) / 100;
      return Math.max(0, Math.min(1, v));
    };
    const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;

    function audio() {
      if (!AC || dead) return null;
      if (!ac) {
        try {
          ac = new AC();
          master = ac.createGain();
          master.connect(ac.destination);
        } catch (e) { ac = null; return null; }
      }
      master.gain.value = muted() ? 0 : 0.55 * volume();
      if (ac.state === 'suspended') ac.resume().catch(() => {});
      return ac;
    }

    function tone(p, ms) {
      const c = audio();
      if (!c || muted() || !volume()) return;
      try {
        const t = c.currentTime + 0.005, d = ms / 1000;
        const o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain();
        o.type = 'triangle'; o.frequency.value = PADS[p].hz;
        o2.type = 'sine'; o2.frequency.value = PADS[p].hz * 2;
        const g2 = c.createGain(); g2.gain.value = 0.18;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.5, t + 0.012);
        g.gain.setValueAtTime(0.5, t + Math.max(0.02, d - 0.06));
        g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.08);
        o.connect(g); o2.connect(g2).connect(g); g.connect(master);
        o.start(t); o2.start(t); o.stop(t + d + 0.1); o2.stop(t + d + 0.1);
      } catch (e) { /* audio can fail at any point; the lights carry on */ }
    }

    function buzz() {
      const c = audio();
      if (!c || muted() || !volume()) return;
      try {
        const t = c.currentTime + 0.005;
        const o = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(140, t);
        o.frequency.exponentialRampToValueAtTime(70, t + 0.55);
        lp.type = 'lowpass'; lp.frequency.value = 700;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.45, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
        o.connect(lp).connect(g).connect(master);
        o.start(t); o.stop(t + 0.65);
      } catch (e) { /* ignore */ }
    }

    /* ---- build ---- */
    const shapeEl = p => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', 'arx-echo__shape'); svg.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', SHAPES[p.shape]);
      svg.appendChild(path);
      return svg;
    };
    const pads = PADS.map((p, i) => h('button.arx-echo__pad', {
      type: 'button', dataset: { p: String(i), shape: p.shape }, style: { '--pc': p.color },
      'aria-label': `Pad ${i + 1}, ${p.name} ${p.shape}, ${p.where}`,
    }, shapeEl(p), h('span.arx-echo__key', { 'aria-hidden': 'true' }, h('b', { text: String(i + 1) }), h('i', { text: p.glyph }))));
    const hub = h('div.arx-echo__hub');
    const disc = h('div.arx-echo__disc', { role: 'group', 'aria-label': 'Echo pads' }, h('div.arx-echo__ring', pads), hub);
    const foot = h('div.arx-echo__foot');
    const live = h('div', { 'aria-live': 'polite', style: { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)' } });
    const reduced = !!ctx.reduced || document.body.classList.contains('reduce-motion')
      || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    const root = h('div.arx-echo.is-intro' + (reduced ? '.is-reduced' : ''), { style: { '--ga': ctx.accent || 'var(--accent, #ff456d)' } },
      h('style', { text: CSS }), disc, foot, live);
    el.appendChild(root);
    const say = msg => { live.textContent = ''; live.textContent = msg; };

    /* the colour-blind colours swap the pads to that set; they, or the setting, put the shapes on */
    let shapes = false;
    function paintLook() {
      const cb = ctx.palette === 'cb';
      shapes = cb || !!ctx.settings?.shapes;
      root.classList.toggle('has-shapes', shapes);
      pads.forEach((b, i) => b.style.setProperty('--pc', cb ? PADS[i].cb : PADS[i].color));
    }
    paintLook();
    const padName = i => (shapes ? `${PADS[i].name} ${PADS[i].shape}` : PADS[i].name);

    /* Strict: the step that is due must come within stepMs */
    function armStep() {
      if (MODE !== 'strict') return;
      if (stepT) { clearTimeout(stepT); timers.delete(stepT); }
      stepT = later(() => { stepT = 0; if (state === 'input' && !paused) fail(null); }, stepMs);
    }
    function clearStep() { if (stepT) { clearTimeout(stepT); timers.delete(stepT); stepT = 0; } }

    /* ---- one-button scanning ---- */
    function paintScan() { pads.forEach((p, i) => p.classList.toggle('is-scan', i === scan)); }
    function stopScan() {
      if (scanT) { clearTimeout(scanT); timers.delete(scanT); scanT = 0; }
      scan = -1; paintScan();
    }
    function startScan() {
      stopScan();
      if (!one || dead || paused || state !== 'input') return;
      const step = () => {
        if (dead || paused || state !== 'input') return;
        scan = (scan + 1) % PADS.length;
        paintScan();
        say(`${PADS[scan].name}`);
        scanT = later(step, SCAN_MS);
      };
      step();
    }
    function pick() {
      if (!one || state !== 'input' || scan < 0) return;
      const p = scan;
      stopScan();
      press(p);
      if (state === 'input') startScan();
    }

    function setState(s) {
      state = s;
      if (s !== 'input') { stopScan(); clearStep(); }
      root.classList.toggle('is-intro', s === 'intro');
      root.classList.toggle('is-watch', s === 'watch');
      root.classList.toggle('is-over', s === 'over');
      pads.forEach(p => p.setAttribute('aria-disabled', String(s !== 'input')));
    }

    function hubShow(kick, num, msg, bad) {
      hub.replaceChildren(...[                   // (a null child would print "null")
        kick ? h('div.arx-echo__kick', { text: kick }) : null,
        num != null ? h('div.arx-echo__num', { text: String(num) }) : null,
        msg ? h('div.arx-echo__msg' + (bad ? '.is-bad' : ''), { text: msg }) : null,
        /* Free: the tries left, as dots */
        MODE === 'free' && kick !== 'Echo' ? h('div.arx-echo__tries', { 'aria-label': `${tries} of ${TRIES} tries left` },
          Array.from({ length: TRIES }, (_, i) => h('i' + (i >= tries ? '.is-gone' : '')))) : null].filter(Boolean));
    }

    function footHint() {
      const quiet = !AC ? 'This browser has no Web Audio, so Echo is lights only.'
        : muted() || !volume() ? 'Sound is off, so Echo is lights only — the lights alone are enough to play.' : null;
      foot.className = 'arx-echo__foot' + (quiet ? ' is-warn' : '');
      foot.replaceChildren(...(quiet ? [quiet]
        : one ? ['One button: when the ring is on the pad you want, press ', h('kbd', { text: 'Space' }), `, click or tap · ${rule}`]
        : coarse ? [`Tap the pads in the same order · ${rule}`]
          : ['Tap the pads, press ', h('kbd', { text: '1' }), '–', h('kbd', { text: '4' }), ` or use the arrow keys · ${rule}`]));
    }
    /* what this mode asks, in a few words */
    const rule = MODE === 'strict' ? `${stepMs / 1000} seconds a step` : MODE === 'free' ? `a miss plays the round again, ${TRIES} tries` : 'no time limit';

    function light(p, ms) {
      const pad = pads[p];
      pad.classList.add('is-lit');
      later(() => pad.classList.remove('is-lit'), ms);
    }

    /* ---- the game ---- */
    function intro() {
      setState('intro');
      const btn = h('button.arx-echo__start', { type: 'button' }, icon('play', { fill: true }), 'Start');
      listen(btn, 'click', start);
      hub.replaceChildren(h('div.arx-echo__kick', { text: 'Echo' }), btn);
      footHint();
      requestAnimationFrame(() => { if (!dead) btn.focus({ preventScroll: true }); });
    }

    function start() {
      if (dead || state !== 'intro') return;
      audio();                       // created inside the click: the browser allows sound from here on
      seq.length = 0;
      longest = 0;
      tries = TRIES; misses = 0;
      next();
    }

    function next() {
      cleared = false;
      seq.push(Math.floor(Math.random() * PADS.length));
      play(700);
    }

    /* play the whole sequence, then hand over */
    function play(delay) {
      if (dead) return;
      clearAll();
      pads.forEach(p => p.classList.remove('is-lit', 'is-due'));
      setState('watch');
      pos = 0;
      hubShow(`Round ${seq.length}`, seq.length, 'Watch');
      say(`Round ${seq.length}. Watch and listen.`);
      const on = Math.max(210, 480 - seq.length * 18);
      const gap = Math.max(80, 170 - seq.length * 6);
      let t = delay;
      seq.forEach(p => {
        later(() => { light(p, on); tone(p, on); }, t);
        t += on + gap;
      });
      later(() => {
        setState('input');
        hubShow(`Round ${seq.length}`, `0/${seq.length}`, 'Your turn');
        say(`Your turn. ${seq.length} ${seq.length === 1 ? 'step' : 'steps'}.${one ? ' Press when the ring is on the pad you want.' : ''}${MODE === 'strict' ? ` ${stepMs / 1000} seconds a step.` : ''}`);
        startScan();
        armStep();
      }, t);
    }

    function press(p) {
      if (dead || paused || state !== 'input') return;
      light(p, PRESS_MS);
      if (p !== seq[pos]) return MODE === 'free' && tries > 1 ? miss(p) : fail(p);
      tone(p, PRESS_MS);
      pos++;
      if (pos < seq.length) {
        hubShow(`Round ${seq.length}`, `${pos}/${seq.length}`, 'Your turn');
        armStep();
        return;
      }
      longest = seq.length;
      cleared = true;
      onScore(longest);
      setState('watch');
      hubShow(`Round ${seq.length}`, seq.length, 'Nice!');
      say(`Correct. ${longest} in a row.`);
      later(next, 650);
    }

    /* Free: a wrong pad costs a try, and the same round is played again */
    function miss(wrong) {
      tries--; misses++;
      setState('watch');
      buzz();
      const due = seq[pos];
      pads[due].classList.add('is-due');
      hubShow(`Round ${seq.length}`, longest, `It was ${padName(due)}`, true);
      say(`Wrong pad: ${padName(wrong)}. It was ${padName(due)}. ${tries} ${tries === 1 ? 'try' : 'tries'} left; the round plays again.`);
      later(() => { pads[due].classList.remove('is-due'); play(300); }, 1400);
    }

    /* wrong: the pad pressed, or null when Strict's time ran out */
    function fail(wrong) {
      if (MODE === 'free') { tries = 0; misses++; }
      setState('over');
      buzz();
      const due = seq[pos];
      pads[due].classList.add('is-due');
      hubShow('Game over', longest, wrong === null ? `Too slow: it was ${padName(due)}` : `It was ${padName(due)}`, true);
      say(`${wrong === null ? 'Too slow' : 'Wrong pad'}. It was ${padName(due)}. Longest sequence ${longest}.`);
      const how = wrong === null ? `ran out of time on step ${pos + 1} of round ${seq.length}` : `missed step ${pos + 1} of round ${seq.length} (${padName(wrong)} instead of ${padName(due)})`;
      onEnd({
        score: longest, won: false,
        detail: `Longest sequence: ${longest}${MODE === 'classic' ? '' : MODE === 'strict' ? ' · Strict' : ` · Free, ${misses} ${misses === 1 ? 'miss' : 'misses'}`} · ${how}`,
      });
    }

    /* pointer presses answer on pointerdown (no click delay); a keyboard
       Enter/Space on a focused pad arrives as a click with detail 0 */
    listen(disc, 'pointerdown', e => {
      if (one) return;                 /* one-button mode: see the root's listener below */
      const b = e.target.closest?.('.arx-echo__pad');
      if (!b || (e.button !== undefined && e.button !== 0)) return;
      e.preventDefault();
      press(Number(b.dataset.p));
    });
    listen(disc, 'click', e => {
      if (one) return;
      const b = e.target.closest?.('.arx-echo__pad');
      if (b && e.detail === 0) press(Number(b.dataset.p));
    });
    /* one-button mode: a click or tap anywhere on the game picks the pad the ring is on */
    listen(root, 'pointerdown', e => {
      if (!one || state !== 'input' || (e.button !== undefined && e.button !== 0)) return;
      if (e.target.closest?.('.arx-echo__start')) return;
      e.preventDefault();
      pick();
    });
    /* 1–4 or the arrows play a pad (also a controller's D-pad, through the
       bridge); Space / Enter press Start (a controller's A / Start) */
    listen(window, 'keydown', e => {
      if (dead || paused) return;
      let k = ['1', '2', '3', '4'].indexOf(e.key);
      if (k < 0) k = PADS.findIndex(p => p.arrow === e.key);
      const go = state === 'intro' && (e.key === ' ' || e.key === 'Enter');
      const sel = one && state === 'input' && (e.key === ' ' || e.key === 'Enter');
      if ((k < 0 && !go && !sel) || !ownsKey(root, e)) return;
      e.preventDefault();
      if (e.repeat) return;
      if (go) start(); else if (sel) pick(); else press(k);
    });
    const onSound = () => { if (dead) return; footHint(); if (master) master.gain.value = muted() ? 0 : 0.55 * volume(); };
    const unsubs = [store.sub?.('prefs', onSound), store.sub?.('portal', onSound)];

    intro();

    return {
      stop() {
        if (dead) return;
        dead = true;
        clearAll();
        offs.splice(0).forEach(off => off());
        unsubs.forEach(off => { try { off?.(); } catch (e) { /* ignore */ } });
        if (ac) { try { ac.close().catch(() => {}); } catch (e) { /* already closed */ } ac = null; master = null; }
        root.remove();
      },
      pause() {
        if (dead || paused) return;
        paused = true;
        stopScan();
        if (state === 'watch' || state === 'input') {
          clearAll();
          pads.forEach(p => p.classList.remove('is-lit'));
          setState('watch');
          hubShow(`Round ${seq.length}`, seq.length, 'Paused');
        }
        if (ac && ac.state === 'running') ac.suspend().catch(() => {});
      },
      resume() {
        if (dead || !paused) return;
        paused = false;
        paintLook();                 /* the colours or the shapes may have changed in Options */
        if (ac && ac.state === 'suspended') ac.resume().catch(() => {});
        /* the round starts over, nothing is lost; a round already repeated
           goes straight on to the next one */
        if (seq.length && state !== 'over') { if (cleared) next(); else play(600); }
      },
      /* a read-only snapshot for automated play-tests */
      peek: () => ({ state, paused, round: seq.length, pos, longest, seq: seq.slice(), oneButton: one, scan, mode: MODE, tries, misses, shapes, stepMs: MODE === 'strict' ? stepMs : null,
        colors: pads.map(b => b.style.getPropertyValue('--pc')) }),
    };
  },
};

/* Keys reach the game only while its window is the active one and focus
   is not parked on some other control (a shell button, a text field).
   The controller bridge (core/padmap.js) dispatches its synthetic keys
   straight to window, so for those the focused element stands in for
   the target (Node.contains(window) would throw). */
function ownsKey(root, e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (!root.isConnected || !root.getClientRects().length) return false;
  const win = root.closest('.win');
  if (win && !win.classList.contains('is-active')) return false;
  const t = e.target instanceof Element ? e.target : document.activeElement;
  if (!t || t === document.body || t === document.documentElement || root.contains(t)) return true;
  if (t.closest('input,textarea,select,button,a[href],[contenteditable="true"],[role="button"]')) return false;
  return !win || win.contains(t);
}
