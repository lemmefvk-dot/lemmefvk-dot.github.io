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
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { store } from '../core/store.js';

/* clockwise from the top; `arrow` is the key that also plays the pad */
const PADS = [
  { name: 'green', where: 'top', color: '#22c55e', hz: 329.63, arrow: 'ArrowUp', glyph: '↑' },
  { name: 'red', where: 'right', color: '#f43f5e', hz: 440.0, arrow: 'ArrowRight', glyph: '→' },
  { name: 'yellow', where: 'bottom', color: '#facc15', hz: 554.37, arrow: 'ArrowDown', glyph: '↓' },
  { name: 'blue', where: 'left', color: '#3b82f6', hz: 659.25, arrow: 'ArrowLeft', glyph: '←' },
];
const PRESS_MS = 230;

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
.arx-echo__pad:focus-visible{outline:none;box-shadow:0 0 0 3px var(--ink-0,#fff),inset 0 1px 0 rgba(255,255,255,.12)}
.arx-echo.is-watch .arx-echo__pad,.arx-echo.is-over .arx-echo__pad,.arx-echo.is-intro .arx-echo__pad{cursor:default}
.arx-echo.is-reduced .arx-echo__pad{transition:none}
.arx-echo__key{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(-45deg);display:inline-flex;align-items:center;gap:.4em;white-space:nowrap;
  font:700 max(11px,calc(var(--size) * .03))/1 var(--mono,ui-monospace,monospace);color:rgba(255,255,255,.8);
  padding:.35em .55em;border-radius:6px;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.14);pointer-events:none}
.arx-echo__key i{font-style:normal;font-weight:600;opacity:.62}
.arx-echo__pad.is-lit .arx-echo__key,.arx-echo__pad.is-due .arx-echo__key{color:rgba(0,0,0,.72);background:rgba(255,255,255,.35);border-color:rgba(0,0,0,.14)}
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
    const pads = PADS.map((p, i) => h('button.arx-echo__pad', {
      type: 'button', dataset: { p: String(i) }, style: { '--pc': p.color },
      'aria-label': `Pad ${i + 1}, ${p.name}, ${p.where}`,
    }, h('span.arx-echo__key', { 'aria-hidden': 'true' }, h('b', { text: String(i + 1) }), h('i', { text: p.glyph }))));
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

    function setState(s) {
      state = s;
      root.classList.toggle('is-intro', s === 'intro');
      root.classList.toggle('is-watch', s === 'watch');
      root.classList.toggle('is-over', s === 'over');
      pads.forEach(p => p.setAttribute('aria-disabled', String(s !== 'input')));
    }

    function hubShow(kick, num, msg, bad) {
      hub.replaceChildren(...[                   // (a null child would print "null")
        kick ? h('div.arx-echo__kick', { text: kick }) : null,
        num != null ? h('div.arx-echo__num', { text: String(num) }) : null,
        msg ? h('div.arx-echo__msg' + (bad ? '.is-bad' : ''), { text: msg }) : null].filter(Boolean));
    }

    function footHint() {
      const quiet = !AC ? 'This browser has no Web Audio, so Echo is lights only.'
        : muted() || !volume() ? 'Sound is off, so Echo is lights only — the lights alone are enough to play.' : null;
      foot.className = 'arx-echo__foot' + (quiet ? ' is-warn' : '');
      foot.replaceChildren(...(quiet ? [quiet]
        : coarse ? ['Tap the pads in the same order · no time limit']
          : ['Tap the pads, press ', h('kbd', { text: '1' }), '–', h('kbd', { text: '4' }), ' or use the arrow keys · no time limit']));
    }

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
        say(`Your turn. ${seq.length} ${seq.length === 1 ? 'step' : 'steps'}.`);
      }, t);
    }

    function press(p) {
      if (dead || paused || state !== 'input') return;
      light(p, PRESS_MS);
      if (p !== seq[pos]) return fail(p);
      tone(p, PRESS_MS);
      pos++;
      if (pos < seq.length) {
        hubShow(`Round ${seq.length}`, `${pos}/${seq.length}`, 'Your turn');
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

    function fail(wrong) {
      setState('over');
      buzz();
      const due = seq[pos];
      pads[due].classList.add('is-due');
      hubShow('Game over', longest, `It was ${PADS[due].name}`, true);
      say(`Wrong pad. It was ${PADS[due].name}. Longest sequence ${longest}.`);
      onEnd({
        score: longest, won: false,
        detail: `Longest sequence: ${longest} · missed step ${pos + 1} of round ${seq.length} (${PADS[wrong].name} instead of ${PADS[due].name})`,
      });
    }

    /* pointer presses answer on pointerdown (no click delay); a keyboard
       Enter/Space on a focused pad arrives as a click with detail 0 */
    listen(disc, 'pointerdown', e => {
      const b = e.target.closest?.('.arx-echo__pad');
      if (!b || (e.button !== undefined && e.button !== 0)) return;
      e.preventDefault();
      press(Number(b.dataset.p));
    });
    listen(disc, 'click', e => {
      const b = e.target.closest?.('.arx-echo__pad');
      if (b && e.detail === 0) press(Number(b.dataset.p));
    });
    /* 1–4 or the arrows play a pad (also a controller's D-pad, through the
       bridge); Space / Enter press Start (a controller's A / Start) */
    listen(window, 'keydown', e => {
      if (dead || paused) return;
      let k = ['1', '2', '3', '4'].indexOf(e.key);
      if (k < 0) k = PADS.findIndex(p => p.arrow === e.key);
      const go = state === 'intro' && (e.key === ' ' || e.key === 'Enter');
      if ((k < 0 && !go) || !ownsKey(root, e)) return;
      e.preventDefault();
      if (e.repeat) return;
      if (go) start(); else press(k);
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
        if (ac && ac.state === 'suspended') ac.resume().catch(() => {});
        /* the round starts over, nothing is lost; a round already repeated
           goes straight on to the next one */
        if (seq.length && state !== 'over') { if (cleared) next(); else play(600); }
      },
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
