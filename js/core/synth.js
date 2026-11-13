/* ============================================================
   synth.js — the Static Synth's sound engine.

   It only needs a BaseAudioContext, so the same code plays live through
   an AudioContext and renders offline through an OfflineAudioContext
   (the tests render notes this way and measure the samples).

   Signal path
     per voice:  osc1 + osc2 ─▶ filter (envelope + LFO) ─▶ amp envelope ─┐
     shared:     voices ─▶ dry ───────────────────────────────┐          │
                           └▶ delay ⟲ feedback ─▶ wet ────────┴▶ master ─▶ limiter ─▶ soft clip ─▶ out
     The LFO is one oscillator shared by every voice (vibrato on each
     oscillator's detune, wobble on each filter's detune).

   Safe output: the limiter is a fast, hard-ratio DynamicsCompressor; after
   it a WaveShaper bends anything still above 0.8 towards a ceiling of 0.98,
   so no chord, delay build-up or loud preset can leave the engine above that.

   Polyphony: at most `maxVoices` sounding voices; one more steals the
   quietest-looking one (a voice already releasing first, otherwise the
   oldest) with a very short fade so it doesn't click.

   Notes are reference-counted per source ('kbd:a', 'ptr:1', 'midi:3'…), so
   two inputs can hold one key. A sustain pedal holds released notes until
   it comes up. allNotesOff() lets go of everything, pedal included.
   ============================================================ */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const WAVES = ['sine', 'triangle', 'sawtooth', 'square'];
const FILTERS = ['lowpass', 'highpass', 'bandpass'];

/* name: [min, max, default] for every number in a patch */
export const RANGES = {
  o1oct: [-2, 2, 0], o2oct: [-2, 2, 0], o2level: [0, 1, 0.5], o2detune: [-50, 50, 7],
  a: [0.001, 3, 0.01], d: [0.01, 3, 0.3], s: [0, 1, 0.6], r: [0.01, 4, 0.3],
  cutoff: [60, 16000, 4000], res: [0.1, 18, 1], fenv: [0, 6, 1], fdecay: [0.02, 3, 0.4],
  lfoRate: [0.1, 20, 5], lfoPitch: [0, 100, 0], lfoFilter: [0, 2400, 0],
  delayTime: [0.02, 1, 0.3], delayFb: [0, 0.85, 0.3], delayMix: [0, 1, 0],
  volume: [0, 1, 0.7],
};
export const BASE = {
  o1wave: 'sawtooth', o2wave: 'sawtooth', filter: 'lowpass', lfoWave: 'sine',
  ...Object.fromEntries(Object.entries(RANGES).map(([k, v]) => [k, v[2]])),
};

/** Any object in, a complete in-range patch out (saved presets are untrusted). */
export function cleanPatch(p) {
  const o = {};
  const src = p && typeof p === 'object' ? p : {};
  for (const [k, [lo, hi, def]] of Object.entries(RANGES)) {
    const n = Number(src[k]);
    o[k] = Number.isFinite(n) ? clamp(k.endsWith('oct') ? Math.round(n) : n, lo, hi) : def;
  }
  o.o1wave = WAVES.includes(src.o1wave) ? src.o1wave : BASE.o1wave;
  o.o2wave = WAVES.includes(src.o2wave) ? src.o2wave : BASE.o2wave;
  o.lfoWave = WAVES.includes(src.lfoWave) ? src.lfoWave : BASE.lfoWave;
  o.filter = FILTERS.includes(src.filter) ? src.filter : BASE.filter;
  return o;
}

const P = (id, name, p) => ({ id, name, p: cleanPatch({ ...BASE, ...p }) });
export const PRESETS = [
  P('warm-pad', 'Warm Pad', { o1wave: 'sawtooth', o2wave: 'triangle', o2level: 0.7, o2detune: 9, a: 0.6, d: 0.8, s: 0.7, r: 1.4, cutoff: 1400, res: 1.5, fenv: 0.6, fdecay: 1.5, lfoRate: 0.4, lfoPitch: 6, delayMix: 0.18, delayTime: 0.42, delayFb: 0.35, volume: 0.6 }),
  P('saw-lead', 'Saw Lead', { o1wave: 'sawtooth', o2wave: 'square', o2level: 0.35, o2oct: 0, o2detune: 12, a: 0.005, d: 0.25, s: 0.8, r: 0.25, cutoff: 3200, res: 4, fenv: 1.2, fdecay: 0.35, lfoRate: 5.5, lfoPitch: 14, delayMix: 0.22, delayTime: 0.28, delayFb: 0.4, volume: 0.6 }),
  P('pluck', 'Pluck', { o1wave: 'triangle', o2wave: 'sawtooth', o2level: 0.5, o2oct: 1, o2detune: 4, a: 0.002, d: 0.22, s: 0, r: 0.2, cutoff: 900, res: 2, fenv: 3.2, fdecay: 0.18, delayMix: 0.12, delayTime: 0.22, delayFb: 0.3, volume: 0.7 }),
  P('sub-bass', 'Sub Bass', { o1wave: 'sine', o1oct: -1, o2wave: 'square', o2oct: -1, o2level: 0.25, o2detune: 0, a: 0.004, d: 0.2, s: 0.85, r: 0.12, cutoff: 500, res: 1.2, fenv: 1.5, fdecay: 0.2, volume: 0.75 }),
  P('soft-keys', 'Soft Keys', { o1wave: 'sine', o2wave: 'triangle', o2oct: 1, o2level: 0.35, o2detune: 3, a: 0.004, d: 0.9, s: 0.25, r: 0.5, cutoff: 3000, res: 0.8, fenv: 1, fdecay: 0.6, lfoRate: 4.5, lfoPitch: 3, delayMix: 0.1, volume: 0.7 }),
  P('brass', 'Brass', { o1wave: 'sawtooth', o2wave: 'sawtooth', o2level: 0.8, o2detune: 6, a: 0.06, d: 0.3, s: 0.75, r: 0.2, cutoff: 1100, res: 1.5, fenv: 2.4, fdecay: 0.3, volume: 0.55 }),
  P('space-bells', 'Space Bells', { o1wave: 'sine', o2wave: 'sine', o2oct: 2, o2level: 0.45, o2detune: 14, a: 0.003, d: 1.8, s: 0, r: 1.8, cutoff: 8000, res: 0.5, fenv: 0, lfoRate: 3, lfoPitch: 5, delayMix: 0.45, delayTime: 0.38, delayFb: 0.6, volume: 0.6 }),
  P('wobble-bass', 'Wobble Bass', { o1wave: 'sawtooth', o1oct: -1, o2wave: 'square', o2oct: -1, o2level: 0.5, o2detune: 5, a: 0.005, d: 0.2, s: 0.9, r: 0.15, cutoff: 420, res: 8, fenv: 0.5, fdecay: 0.3, lfoWave: 'triangle', lfoRate: 2.5, lfoFilter: 1500, volume: 0.6 }),
];

/* GarageBand-style typing map: letter → semitone offset from the keyboard's low C */
export const KEYMAP = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ';': 16 };
export const freqOf = m => 440 * Math.pow(2, (m - 69) / 12);
/* keys feel more alive when velocity is not simply linear */
export const velGain = v => 0.12 + 0.88 * clamp(Number.isFinite(v) ? v : 1, 0, 1);

const CEIL = 0.98, KNEE = 0.8;
function softCurve() {
  const n = 4097, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1, a = Math.abs(x);
    const y = a <= KNEE ? a : KNEE + (CEIL - KNEE) * Math.tanh((a - KNEE) / (CEIL - KNEE));
    c[i] = x < 0 ? -y : y;
  }
  return c;
}

/**
 * createSynth(ac, { patch, maxVoices, destination })
 *   noteOn(note, vel01, src, when?)   noteOff(note, src, when?)   sustain(down, when?)
 *   allNotesOff()   setPatch(p)   set(key, value)   voices()   dispose()
 */
export function createSynth(ac, opts = {}) {
  let patch = cleanPatch(opts.patch || PRESETS[0].p);
  let maxVoices = clamp(Math.round(opts.maxVoices || 8), 1, 32);

  const voicesBus = ac.createGain();
  const dry = ac.createGain();
  const delay = ac.createDelay(1.1);
  const fb = ac.createGain();
  const wet = ac.createGain();
  const master = ac.createGain();
  const limiter = ac.createDynamicsCompressor();
  const clip = ac.createWaveShaper();
  const lfo = ac.createOscillator();
  const lfoPitch = ac.createGain();
  const lfoFilter = ac.createGain();
  limiter.threshold.value = -4; limiter.knee.value = 0; limiter.ratio.value = 20;
  limiter.attack.value = 0.001; limiter.release.value = 0.12;
  clip.curve = softCurve();
  voicesBus.connect(dry); dry.connect(master);
  voicesBus.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(master);
  master.connect(limiter); limiter.connect(clip); clip.connect(opts.destination || ac.destination);
  lfo.connect(lfoPitch); lfo.connect(lfoFilter);
  lfo.start();

  const all = new Set();                 /* every sounding voice, oldest first */
  const heldBy = new Map();              /* note -> Set(src) */
  const sounding = new Map();            /* note -> the voice that key is holding */
  const pedalHeld = new Set();           /* notes let go of while the pedal was down */
  let pedal = false, gone = false, seq = 0;

  function applyShared() {
    const t = ac.currentTime;
    master.gain.setTargetAtTime(patch.volume * patch.volume, t, 0.01);   /* squared: a slider feels even */
    delay.delayTime.setTargetAtTime(patch.delayTime, t, 0.02);
    fb.gain.setTargetAtTime(patch.delayFb, t, 0.02);
    wet.gain.setTargetAtTime(patch.delayMix, t, 0.02);
    dry.gain.setTargetAtTime(1 - patch.delayMix * 0.35, t, 0.02);
    lfo.type = patch.lfoWave;
    lfo.frequency.setTargetAtTime(patch.lfoRate, t, 0.02);
    lfoPitch.gain.setTargetAtTime(patch.lfoPitch, t, 0.02);
    lfoFilter.gain.setTargetAtTime(patch.lfoFilter, t, 0.02);
  }
  applyShared();
  master.gain.value = patch.volume * patch.volume;
  delay.delayTime.value = patch.delayTime; fb.gain.value = patch.delayFb;
  wet.gain.value = patch.delayMix; dry.gain.value = 1 - patch.delayMix * 0.35;
  lfo.frequency.value = patch.lfoRate; lfoPitch.gain.value = patch.lfoPitch; lfoFilter.gain.value = patch.lfoFilter;

  function build(note, vel, when) {
    const p = patch, t = Math.max(when, ac.currentTime);
    const f = freqOf(note);
    const filt = ac.createBiquadFilter();
    filt.type = p.filter; filt.Q.value = p.res;
    const top = Math.min(18000, p.cutoff * Math.pow(2, p.fenv));
    filt.frequency.setValueAtTime(top, t);
    filt.frequency.setTargetAtTime(p.cutoff, t, p.fdecay / 3);
    const amp = ac.createGain();
    const peak = 0.22 * velGain(vel);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + p.a);
    amp.gain.setTargetAtTime(peak * p.s, t + p.a, p.d / 3);
    const oscs = [];
    const mk = (wave, oct, cents, level) => {
      const o = ac.createOscillator();
      o.type = wave; o.frequency.value = f * Math.pow(2, oct); o.detune.value = cents;
      const g = ac.createGain(); g.gain.value = level;
      o.connect(g); g.connect(filt);
      lfoPitch.connect(o.detune);
      oscs.push(o, g);
      o.start(t);
      return o;
    };
    const o1 = mk(p.o1wave, p.o1oct, 0, 1);
    const o2 = p.o2level > 0.001 ? mk(p.o2wave, p.o2oct, p.o2detune, p.o2level) : null;
    lfoFilter.connect(filt.detune);
    filt.connect(amp); amp.connect(voicesBus);
    return { note, amp, filt, oscs, o1, o2, peak, t, id: ++seq, releasing: false, rel: p.r, ended: false };
  }

  function tidy(v) {
    if (v.ended) return;
    v.ended = true;
    all.delete(v);
    if (sounding.get(v.note) === v) sounding.delete(v.note);
    for (const n of v.oscs) { try { n.disconnect(); } catch (e) { /* done */ } }
    try { lfoPitch.disconnect(v.o1.detune); } catch (e) { /* done */ }
    if (v.o2) { try { lfoPitch.disconnect(v.o2.detune); } catch (e) { /* done */ } }
    try { lfoFilter.disconnect(v.filt.detune); } catch (e) { /* done */ }
    try { v.filt.disconnect(); } catch (e) { /* done */ }
    try { v.amp.disconnect(); } catch (e) { /* done */ }
  }

  function release(v, when, fast) {
    if (v.releasing) { if (!fast) return; }
    const t = Math.max(when == null ? ac.currentTime : when, ac.currentTime, v.t);
    v.releasing = true;
    const g = v.amp.gain, rel = fast ? 0.025 : v.rel;
    try {
      if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t);
      else { g.cancelScheduledValues(t); }
      g.setTargetAtTime(0, t, rel / 4);
    } catch (e) { /* closed */ }
    const stopAt = t + rel * 1.8 + 0.05;
    for (const o of [v.o1, v.o2]) if (o) { try { o.stop(stopAt); } catch (e) { /* already stopped */ } }
    v.o1.onended = () => tidy(v);
    if (!(typeof OfflineAudioContext !== 'undefined' && ac instanceof OfflineAudioContext)) setTimeout(() => tidy(v), (stopAt - ac.currentTime) * 1000 + 250);   /* a context whose clock is stalled never fires onended */
  }

  function steal() {
    while (all.size >= maxVoices) {
      let pick = null;
      for (const v of all) { if (v.releasing && !v.ended) { pick = v; break; } }
      if (!pick) pick = all.values().next().value;
      if (!pick) return;
      for (const [n, v] of sounding) if (v === pick) sounding.delete(n);
      release(pick, null, true);
      all.delete(pick);              /* counts as gone now; its fade-out finishes by itself */
      pick.o1.onended = () => tidy(pick);
    }
  }

  function noteOn(note, vel = 1, src = 'x', when) {
    if (gone) return;
    note = Math.round(note);
    if (note < 0 || note > 127) return;
    const t = when == null ? ac.currentTime : when;
    let s = heldBy.get(note);
    const first = !s || s.size === 0;
    if (!s) { s = new Set(); heldBy.set(note, s); }
    s.add(src);
    if (!first && !pedalHeld.has(note)) return;           /* another source already holds it */
    pedalHeld.delete(note);
    const old = sounding.get(note);
    if (old) { release(old, t, false); sounding.delete(note); }
    steal();
    const v = build(note, vel, t);
    all.add(v);
    sounding.set(note, v);
  }
  function noteOff(note, src = 'x', when) {
    note = Math.round(note);
    const s = heldBy.get(note);
    if (!s || !s.delete(src)) return;
    if (s.size) return;
    heldBy.delete(note);
    if (pedal) { pedalHeld.add(note); return; }
    const v = sounding.get(note);
    if (v) { release(v, when, false); sounding.delete(note); }
  }
  function sustain(down, when) {
    if (down) { pedal = true; return; }
    pedal = false;
    for (const n of [...pedalHeld]) {
      pedalHeld.delete(n);
      const v = sounding.get(n);
      if (v) { release(v, when, false); sounding.delete(n); }
    }
  }
  function allNotesOff() {
    pedal = false; pedalHeld.clear(); heldBy.clear(); sounding.clear();
    for (const v of [...all]) release(v, null, false);
  }
  function setPatch(next) { patch = cleanPatch(next); applyShared(); }
  function set(key, value) { setPatch({ ...patch, [key]: value }); }
  function setMaxVoices(n) { maxVoices = clamp(Math.round(n) || 1, 1, 32); }
  function dispose() {
    if (gone) return;
    gone = true;
    for (const v of [...all]) {
      for (const o of [v.o1, v.o2]) if (o) { try { o.stop(); } catch (e) { /* ok */ } }
      tidy(v);
    }
    try { lfo.stop(); } catch (e) { /* ok */ }
    for (const n of [lfo, lfoPitch, lfoFilter, voicesBus, dry, delay, fb, wet, master, limiter, clip]) { try { n.disconnect(); } catch (e) { /* ok */ } }
    heldBy.clear(); sounding.clear(); pedalHeld.clear();
  }

  return {
    noteOn, noteOff, sustain, allNotesOff, setPatch, set, setMaxVoices, dispose,
    patch: () => ({ ...patch }),
    voices: () => all.size,
    maxVoices: () => maxVoices,
    held: () => [...heldBy.keys()].filter(n => heldBy.get(n).size),
    pedal: () => pedal,
    sustained: () => [...pedalHeld],
    out: limiter,
  };
}

export default { createSynth, cleanPatch, PRESETS, RANGES, BASE, KEYMAP, freqOf, velGain };
