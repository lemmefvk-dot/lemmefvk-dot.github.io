/* ============================================================
   ambient.js — ambient sound, made live in this browser.

   Rain, a fireplace, wind, a café and brown noise, each built from
   Web Audio parts while it plays: looping noise (white, pink and
   brown, generated here and seamless at the loop point), filters swept
   by slow oscillators, and grains — tiny bursts of sound scheduled at
   random moments (rain drops, fire crackles, cups in the café). In
   spooky season two more layers join them for the Spooky preset:
   creaks (the hinge recipe from js/core/sfx.js) and distant thunder.
   Nothing is downloaded, so it all works offline.

   Each sound is a channel with its own level (0–1; the gain is the
   level squared, so the slider feels even). A channel exists only while
   its level is above zero. Channels → a mix bus → a gentle compressor
   → the OS volume (prefs.volume / prefs.muted, followed live) → a fade
   stage (stopping, the sleep timer) → the speakers.

   The sound lives here at module level, in its own AudioContext, so it
   keeps playing when Music is closed or minimised. Control Centre and
   the Sound menu stop it with bus 'ambient:stop'. stop() fades out,
   then stops every source, disconnects every node and closes the
   context.

   Sleep timer: 15, 30, 60 or 90 minutes, kept as a wall-clock moment
   (endsAt) so a busy tab can't stretch it. The last minute fades out;
   at the end the sound stops and the timer clears.

   Focus sessions: with portal.ambient.focus.on, Clock › Focus
   (js/core/focus.js, bus 'focus:change') starts the chosen preset when
   a focus phase starts running, and stops it — only if it started it —
   when the phase is paused or over.

   No metrics claim: like Music's and Radio's players this is sound, not
   a sampler (js/core/metrics.js).

   render(levels, seconds, opts) builds the same graph in an
   OfflineAudioContext, which is what the tests measure.

   Saved under store 'portal.ambient': { v, levels, preset, focus }.
     SOUNDS PRESETS SLEEP_CHOICES FADE_S
     sounds() presets()             what to list now (season-aware)
     state()                        { supported, playing, levels, preset, label, sleep, error, byFocus, focus }
     play() stop(opts) toggle()     stop({ fade: seconds })
     setLevel(id, 0..1) applyPreset(id) setSleep(minutes|0)
     setFocus({ on, preset }) focusReady() → Promise<bool>
     gainFor(id, level)             the channel gain a level asks for
     render(levels, seconds, opts)  → Promise<AudioBuffer>
     inspect()                      the live graph, for tests and Settings
     init()                         listen for focus sessions (main.js, when on)
   bus 'ambient:change' with state() after anything changes.
   ============================================================ */
import { bus } from './bus.js';
import { store } from './store.js';
import * as SEASON from './season.js';
import { SPOOKY } from './sfx.js';

const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
const OAC = typeof window !== 'undefined' ? (window.OfflineAudioContext || window.webkitOfflineAudioContext) : null;

export const KEY = 'portal.ambient';
export const SLEEP_CHOICES = [15, 30, 60, 90];
export const FADE_S = 60;          /* the sleep timer fades out over its last minute */
const AHEAD = 1.5;                 /* grains are scheduled this far ahead (s) */
const TICK_MS = 250;
const NOISE_S = 6;                 /* length of each looping noise buffer */

/* ---------------- what there is ---------------------------------- */
export const SOUNDS = [
  { id: 'rain', name: 'Rain', icon: 'cloud-rain', note: 'A wash of pink noise with drops on top' },
  { id: 'fire', name: 'Fireplace', icon: 'flame', note: 'A low roar, a hiss and crackles' },
  { id: 'wind', name: 'Wind', icon: 'wind', note: 'Noise through slowly sweeping filters, with gusts' },
  { id: 'cafe', name: 'Café', icon: 'coffee', note: 'A murmur of voices, cups and spoons' },
  { id: 'brown', name: 'Brown noise', icon: 'activity', note: 'Deep, steady noise to work to' },
  { id: 'creaks', name: 'Creaks', icon: 'ghost', season: 'spooky', note: 'An old house settling' },
  { id: 'thunder', name: 'Distant thunder', icon: 'zap', season: 'spooky', note: 'Rolling, far away' },
];
export const PRESETS = [
  { id: 'rainy', name: 'Rainy night', icon: 'cloud-rain', mix: { rain: 0.75, wind: 0.22, brown: 0.15 } },
  { id: 'cozy', name: 'Cozy fire', icon: 'flame', mix: { fire: 0.8, wind: 0.15 } },
  { id: 'cafe', name: 'Café', icon: 'coffee', mix: { cafe: 0.8, rain: 0.12 } },
  { id: 'focus', name: 'Focus', icon: 'activity', note: 'Brown noise', mix: { brown: 0.8 } },
  { id: 'spooky', name: 'Spooky', icon: 'ghost', season: 'spooky', mix: { wind: 0.65, creaks: 0.6, thunder: 0.6 } },
];
const BY_ID = new Map(SOUNDS.map(s => [s.id, s]));
const PRESET_BY_ID = new Map(PRESETS.map(p => [p.id, p]));

const seasonal = (x, d) => !x.season || SEASON.spookyOn(d);
/** The presets to offer now: Spooky only in spooky season. */
export const presets = (d = new Date()) => PRESETS.filter(p => seasonal(p, d));
/** The channels to show now: the spooky layers in season, or while they are up. */
export const sounds = (d = new Date()) => SOUNDS.filter(s => seasonal(s, d) || (S.levels && S.levels[s.id] > 0));

/* each sound at level 1 lands near the same loudness (measured with render()) */
const CAL = { rain: 0.75, fire: 0.6, wind: 1.35, cafe: 2.8, brown: 0.55, creaks: 2.6, thunder: 1.5 };
const clamp01 = v => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0; };
export const gainFor = (id, level) => (CAL[id] || 0) * clamp01(level) ** 2;

/* ---------------- small helpers ---------------------------------- */
function rngOf(seed) {            /* mulberry32: a render with a seed is repeatable */
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const expo = (rnd, rate) => -Math.log(1 - rnd() * 0.999999) / rate;

/* Three noise colours, NOISE_S seconds each, per context. The last quarter
   second is cross-faded (equal power) into the first so the loop point has
   no click: d[n-1] and d[0] are neighbouring samples of one long run. */
const noiseFor = new WeakMap();
function noiseBufs(c, rnd) {
  let b = noiseFor.get(c);
  if (b) return b;
  const n = Math.ceil(c.sampleRate * NOISE_S), F = Math.ceil(c.sampleRate * 0.25);
  const make = fill => {
    const raw = new Float32Array(n + F);
    fill(raw);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    d.set(raw.subarray(0, n));
    for (let i = 0; i < F; i++) {
      const x = (i / F) * Math.PI / 2;
      d[i] = raw[i] * Math.sin(x) + raw[n + i] * Math.cos(x);
    }
    return buf;
  };
  const white = make(r => { for (let i = 0; i < r.length; i++) r[i] = rnd() * 2 - 1; });
  const pink = make(r => {           /* Paul Kellet's refined pink filter */
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = -4096; i < r.length; i++) {
      const w = rnd() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      const v = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
      if (i >= 0) r[i] = v;
    }
  });
  const brown = make(r => {           /* a leaky integrator of white noise */
    let last = 0;
    for (let i = -4096; i < r.length; i++) {
      last = (last + 0.02 * (rnd() * 2 - 1)) / 1.02;
      if (i >= 0) r[i] = last * 3.5;
    }
  });
  b = { white, pink, brown };
  noiseFor.set(c, b);
  return b;
}

/* glide an AudioParam to v; offline (or before the clock runs) it is set outright */
function glide(c, param, v, tc = 0.06) {
  const now = c.currentTime;
  try {
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.setTargetAtTime(v, now, tc);
  } catch (e) { param.value = v; }
}

/* ---------------- the sounds ------------------------------------- */
/* Each recipe gets a kit `k` bound to one channel: persistent parts are
   kept (k.src, k.filter, k.gain, k.pan, k.lfo) so they can be stopped and
   disconnected; grains (k.burst, k.ping, k.every) come and go on their own. */
const RECIPES = {
  rain(k) {
    const { rnd } = k;
    const hiss = k.src('pink'), hg = k.gain(0.55);
    hiss.connect(k.filter('highpass', 450)).connect(k.filter('lowpass', 8500)).connect(hg).connect(k.out);
    k.lfo(0.07 + rnd() * 0.03, 0.12, hg.gain);
    const sheet = k.src('white'), sg = k.gain(0.1);
    sheet.connect(k.filter('bandpass', 2600, 0.5)).connect(sg).connect(k.out);
    k.lfo(0.11 + rnd() * 0.04, 0.04, sg.gain);
    /* drops: many small, a few big */
    k.every(70, t => k.burst(t, { f: 2200 + rnd() * 5200, q: 2 + rnd() * 6, peak: 0.04 + rnd() ** 3 * 0.55,
      decay: 0.006 + rnd() * 0.02, pan: rnd() * 1.6 - 0.8 }));
    /* heavier drips off a gutter */
    k.every(2.2, t => k.burst(t, { f: 650 + rnd() * 900, q: 4, peak: 0.2 + rnd() * 0.3, decay: 0.03 + rnd() * 0.04, pan: rnd() * 1.2 - 0.6 }));
  },

  fire(k) {
    const { rnd } = k;
    const roar = k.src('brown'), rg = k.gain(0.6);
    roar.connect(k.filter('lowpass', 480)).connect(rg).connect(k.out);
    k.lfo(0.23 + rnd() * 0.05, 0.22, rg.gain);          /* the flames breathe */
    k.lfo(0.61 + rnd() * 0.1, 0.1, rg.gain);
    const hiss = k.src('white'), hgn = k.gain(0.035);
    hiss.connect(k.filter('highpass', 3200)).connect(hgn).connect(k.out);
    k.lfo(0.4 + rnd() * 0.1, 0.02, hgn.gain);
    /* crackles come in little clusters */
    k.every(6, t => {
      const n = 1 + Math.floor(rnd() * rnd() * 6);
      for (let i = 0; i < n; i++) {
        k.burst(t + rnd() * 0.07, { type: 'highpass', f: 1400 + rnd() * 3600, q: 0.7, peak: 0.08 + rnd() ** 2 * 0.8,
          decay: 0.002 + rnd() * 0.008, pan: rnd() * 1.2 - 0.6, dur: 0.02 });
      }
    });
    /* the odd pop of a knot in the wood */
    k.every(0.45, t => k.burst(t, { f: 320 + rnd() * 420, q: 2, peak: 0.25 + rnd() * 0.3, decay: 0.04 + rnd() * 0.03, pan: rnd() * 0.8 - 0.4 }));
  },

  wind(k) {
    const { rnd } = k;
    for (const [pan, f, q, fr, gr, base] of [[-0.45, 420, 1.2, 0.06, 0.09, 0.5], [0.45, 760, 1.8, 0.045, 0.13, 0.42]]) {
      const s = k.src('pink'), bp = k.filter('bandpass', f, q), g = k.gain(base);
      s.connect(bp).connect(g).connect(k.pan(pan)).connect(k.out);
      k.lfo(fr * (0.8 + rnd() * 0.4), f * 0.55, bp.frequency);
      k.lfo(gr * (0.8 + rnd() * 0.4), base * 0.6, g.gain);
    }
    const low = k.src('brown'), lg = k.gain(0.16);
    low.connect(k.filter('lowpass', 220)).connect(lg).connect(k.out);
    /* a gust now and then: a band of noise that rises, whistles and falls */
    k.every(1 / 7, t => {
      const { c } = k;
      const dur = 2.5 + rnd() * 2;
      const s = c.createBufferSource(); s.buffer = k.noise.pink; s.loop = true;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2.2;
      bp.frequency.setValueAtTime(380, t);
      bp.frequency.linearRampToValueAtTime(900 + rnd() * 500, t + dur * 0.45);
      bp.frequency.linearRampToValueAtTime(450, t + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.35 + rnd() * 0.35, t + dur * 0.45);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const p = c.createStereoPanner(); p.pan.value = rnd() * 1.2 - 0.6;
      s.connect(bp).connect(g).connect(p).connect(k.out);
      s.start(t, rnd() * NOISE_S); s.stop(t + dur + 0.05);
      k.grain();
    }, 2);
  },

  cafe(k) {
    const { rnd } = k;
    const room = k.src('brown'), rg = k.gain(0.07);
    room.connect(k.filter('lowpass', 300)).connect(rg).connect(k.out);
    /* three tables talking: formant bands opening and closing at the pace of speech */
    for (const [pan, r1, r2, base] of [[-0.5, 3.1, 4.3, 1], [0.1, 3.7, 5.2, 0.8], [0.6, 2.6, 4.9, 0.7]]) {
      const src = k.src('pink'), lp = k.filter('lowpass', 3200);
      lp.connect(k.pan(pan)).connect(k.out);
      for (const [f, q, w] of [[480, 3, 1], [1150, 4, 0.6], [2500, 5, 0.25]]) {
        const bp = k.filter('bandpass', f * (0.9 + rnd() * 0.2), q), vg = k.gain(0.3 * w * base);
        src.connect(bp).connect(vg).connect(lp);
        k.lfo(r1 * (0.85 + rnd() * 0.3), 0.19 * w * base, vg.gain);
        k.lfo(r2 * (0.85 + rnd() * 0.3), 0.11 * w * base, vg.gain);
        k.lfo(0.13 + rnd() * 0.1, f * 0.12, bp.frequency);   /* the lilt of a voice */
      }
    }
    /* a cup on a saucer, a spoon in a mug: three inharmonic partials */
    k.every(0.4, t => {
      const f0 = 1800 + rnd() * 2200, peak = 0.025 + rnd() * 0.05, pan = rnd() * 1.4 - 0.7, dur = 0.15 + rnd() * 0.35;
      for (const r of [1, 2.76, 5.4]) k.ping(t, f0 * r, peak / r, dur / Math.sqrt(r), pan);
    }, 0.35);
  },

  brown(k) {
    for (const pan of [-0.6, 0.6]) {
      const s = k.src('brown');
      s.connect(k.filter('highpass', 28)).connect(k.filter('lowpass', 1000)).connect(k.gain(0.7)).connect(k.pan(pan)).connect(k.out);
    }
  },

  creaks(k) {
    const { rnd, c } = k;
    /* the hinge from the spooky sound pack, further off: low-passed, panned */
    k.every(1 / 8, t => {
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800 + rnd() * 1400;
      const p = c.createStereoPanner(); p.pan.value = rnd() * 1.4 - 0.7;
      lp.connect(p).connect(k.out);
      SPOOKY.creak(c, t, 0.35 + rnd() * 0.4, lp);
      k.grain();
    }, 3);
  },

  thunder(k) {
    const { rnd, c } = k;
    k.every(1 / 11, t => {
      const dur = 6 + rnd() * 4, peak = 0.45 + rnd() * 0.55;
      const s = c.createBufferSource(); s.buffer = k.noise.brown; s.loop = true;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.7;
      lp.frequency.setValueAtTime(170 + rnd() * 130, t);
      lp.frequency.linearRampToValueAtTime(85, t + dur);
      const g = c.createGain();
      /* a roll: a swell, a second and third rumble, a long tail */
      let at = t + 0.4 + rnd() * 0.8;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, at);
      at += 0.6 + rnd() * 0.6; g.gain.exponentialRampToValueAtTime(peak * (0.35 + rnd() * 0.3), at);
      at += 0.5 + rnd() * 0.8; g.gain.exponentialRampToValueAtTime(peak * (0.55 + rnd() * 0.45), at);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const p = c.createStereoPanner(); p.pan.value = rnd() * 1.2 - 0.6;
      s.connect(lp).connect(g).connect(p).connect(k.out);
      s.start(t, rnd() * NOISE_S); s.stop(t + dur + 0.05);
      k.grain();
    }, 6);
  },
};

/* ---------------- the graph -------------------------------------- */
/* One mixer on any BaseAudioContext — the live one or an offline render. */
function makeGraph(c, { seed = 1, volume = 1, fadeIn = 0 } = {}) {
  const rnd = rngOf(seed);
  const noise = noiseBufs(c, rnd);
  const realtime = !(OAC && c instanceof OAC);
  const mix = c.createGain();
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 3;
  comp.attack.value = 0.02; comp.release.value = 0.3;
  const master = c.createGain();
  master.gain.value = volume;
  const fade = c.createGain();
  fade.gain.value = fadeIn > 0 ? 0.0001 : 1;
  mix.connect(comp).connect(master).connect(fade).connect(c.destination);
  if (fadeIn > 0) fade.gain.setTargetAtTime(1, c.currentTime, fadeIn / 4);
  const chans = new Map();
  const G = { c, mix, comp, master, fade, chans, masterTarget: volume, fadeTarget: 1, dropping: new Map() };

  function channel(id) {
    const ch = { id, level: 0, target: 0, nodes: [], srcs: [], streams: [], grains: 0 };
    ch.in = c.createGain();
    ch.gain = c.createGain();
    ch.gain.gain.value = 0;
    ch.in.connect(ch.gain).connect(mix);
    ch.nodes.push(ch.in, ch.gain);
    const keep = n => { ch.nodes.push(n); return n; };
    const k = {
      c, rnd, noise, out: ch.in,
      src(kind) {
        const s = keep(c.createBufferSource());
        s.buffer = noise[kind]; s.loop = true;
        ch.srcs.push(s);
        return s;
      },
      filter(type, f, q = 0.7) { const b = keep(c.createBiquadFilter()); b.type = type; b.frequency.value = f; b.Q.value = q; return b; },
      gain(v) { const g = keep(c.createGain()); g.gain.value = v; return g; },
      pan(p) { const n = keep(c.createStereoPanner()); n.pan.value = p; return n; },
      lfo(freq, depth, param) {
        const o = keep(c.createOscillator()); o.frequency.value = freq;
        const g = keep(c.createGain()); g.gain.value = depth;
        o.connect(g).connect(param);
        ch.srcs.push(o);
        return o;
      },
      grain() { ch.grains++; },
      /* a short burst of filtered noise */
      burst(t, { f, q = 1, type = 'bandpass', peak, decay, pan = 0, dur, kind = 'white' }) {
        const len = dur || decay + 0.03;
        const s = c.createBufferSource(); s.buffer = noise[kind];
        const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q;
        const g = c.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(peak, t + 0.001);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.001 + decay);
        const p = c.createStereoPanner(); p.pan.value = pan;
        s.connect(b).connect(g).connect(p).connect(ch.in);
        s.start(t, rnd() * (NOISE_S - len - 0.1), len + 0.02);
        ch.grains++;
      },
      /* a struck partial: a sine with a quick attack and a ringing tail */
      ping(t, f, peak, dur, pan = 0) {
        const o = c.createOscillator(); o.frequency.value = f;
        const g = c.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(peak, t + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        const p = c.createStereoPanner(); p.pan.value = pan;
        o.connect(g).connect(p).connect(ch.in);
        o.start(t); o.stop(t + dur + 0.02);
        ch.grains++;
      },
      /* fire(t) at random moments, `rate` a second on average, at least `gap` s apart */
      every(rate, fire, gap = 0) {
        /* the first one soon, so a layer is heard within a few seconds of starting */
        const st = { next: c.currentTime + (gap ? 0.5 + rnd() * gap : expo(rnd, rate)), rate, gap, fire };
        ch.streams.push(st);
      },
    };
    RECIPES[id](k);
    const t0 = c.currentTime;
    for (const s of ch.srcs) {
      if (s.buffer) s.start(t0, rnd() * s.buffer.duration);
      else s.start(t0);
    }
    return ch;
  }

  G.set = (id, level) => {
    level = clamp01(level);
    const pending = G.dropping.get(id);
    if (pending && level > 0) { clearTimeout(pending.t); G.dropping.delete(id); chans.set(id, pending.ch); }
    let ch = chans.get(id);
    if (!ch && level <= 0) return;
    if (!ch) { ch = channel(id); chans.set(id, ch); }
    ch.level = level;
    ch.target = gainFor(id, level);
    if (realtime) glide(c, ch.gain.gain, ch.target, 0.08);
    else ch.gain.gain.value = ch.target;
    if (level <= 0) {
      /* let the glide finish, then take the channel apart */
      chans.delete(id);
      const t = setTimeout(() => { G.dropping.delete(id); close(ch); }, 450);
      G.dropping.set(id, { ch, t });
    }
  };

  G.fill = until => {
    for (const ch of chans.values()) {
      for (const st of ch.streams) {
        if (st.next < c.currentTime - 0.05) st.next = c.currentTime + expo(rnd, st.rate);  /* a stall: don't burst to catch up */
        while (st.next < until) {
          try { st.fire(st.next); } catch (e) { /* one grain can't stop the rest */ }
          st.next += st.gap + expo(rnd, st.rate);
        }
      }
    }
  };

  G.volume = v => {
    G.masterTarget = v;
    if (realtime) glide(c, master.gain, v, 0.05); else master.gain.value = v;
  };

  /* ramp the fade stage to v over `secs`, starting `at` (default: now). The
     curve falls fast and lands softly: (1 - x)² from where it is. */
  G.fadeTo = (v, secs, at) => {
    G.fadeTarget = v;
    const p = fade.gain;
    const now = c.currentTime;
    const when = at == null ? now : Math.max(now, at);
    const len = Math.max(0.02, secs);
    const from = when <= now ? p.value : 1;
    const n = 64, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = i / (n - 1);
      curve[i] = v < from ? v + (from - v) * (1 - x) ** 2 : from + (v - from) * x * (2 - x);
    }
    try {
      /* a fade already under way is cut where it stands, not jumped */
      if (when <= now && p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(now);
      else p.cancelScheduledValues(when);
      p.setValueCurveAtTime(curve, when, len);
    } catch (e) {
      try { p.cancelScheduledValues(0); p.setValueAtTime(from, now); p.linearRampToValueAtTime(v, now + len); } catch (err) { p.value = v; }
    }
  };

  function close(ch) {
    ch.streams.length = 0;
    for (const s of ch.srcs) { try { s.stop(); } catch (e) { /* never started / already stopped */ } }
    for (const n of ch.nodes) { try { n.disconnect(); } catch (e) { /* already */ } }
    ch.nodes.length = 0;
    ch.srcs.length = 0;
  }

  G.close = () => {
    for (const ch of chans.values()) close(ch);
    chans.clear();
    for (const { ch, t } of G.dropping.values()) { clearTimeout(t); close(ch); }
    G.dropping.clear();
    for (const n of [mix, comp, master, fade]) { try { n.disconnect(); } catch (e) { /* already */ } }
  };

  return G;
}

/* ---------------- state ------------------------------------------ */
const S = { levels: null, preset: null, playing: false, sleep: null, error: null, byFocus: false };
let live = null;          /* { ctx, g, tick } while sound is on */
const closing = new Set();
const made = [];          /* the contexts this module opened, newest last (inspect) */

const saved = () => { const raw = store.get(KEY); return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}; };
function load() {
  if (S.levels) return;
  const s = saved();
  const lv = s.levels && typeof s.levels === 'object' ? s.levels : null;
  S.levels = {};
  for (const x of SOUNDS) S.levels[x.id] = lv ? clamp01(lv[x.id]) : clamp01(PRESETS[0].mix[x.id]);
  S.preset = lv ? (PRESET_BY_ID.has(s.preset) ? s.preset : null) : PRESETS[0].id;
}
function persist() {
  const s = saved();
  store.set(KEY, { ...s, v: 1, levels: { ...S.levels }, preset: S.preset });
}
const anyOn = () => SOUNDS.some(x => S.levels[x.id] > 0);
const outVolume = () => {
  if (store.get('prefs.muted', false) === true) return 0;
  const v = Number(store.get('prefs.volume', 62));
  return Math.max(0, Math.min(100, Number.isFinite(v) ? v : 62)) / 100;
};

function matchPreset(levels) {
  return PRESETS.find(p => SOUNDS.every(x => Math.abs((p.mix[x.id] || 0) - (levels[x.id] || 0)) < 0.005))?.id || null;
}
function label() {
  if (S.preset && PRESET_BY_ID.has(S.preset)) return PRESET_BY_ID.get(S.preset).name;
  const on = SOUNDS.filter(x => S.levels[x.id] > 0).map(x => x.name);
  if (!on.length) return 'Nothing up';
  return on.length <= 2 ? on.join(' + ') : 'Your mix';
}

function focusPrefs() {
  const f = saved().focus || {};
  return { on: f.on === true, preset: PRESET_BY_ID.has(f.preset) ? f.preset : 'focus' };
}

export function state() {
  load();
  const sl = S.sleep;
  return {
    supported: !!AC,
    playing: S.playing,
    levels: { ...S.levels },
    preset: S.preset,
    label: label(),
    sleep: sl ? { minutes: sl.minutes, endsAt: sl.endsAt, left: Math.max(0, sl.endsAt - Date.now()), fading: !!sl.fading } : null,
    error: S.error,
    byFocus: S.byFocus,
    focus: focusPrefs(),
  };
}
const emit = () => bus.emit('ambient:change', state());

/* ---------------- wiring (once, on first use) --------------------- */
let wired = false;
function wire() {
  if (wired || typeof window === 'undefined') return;
  wired = true;
  store.sub('prefs', () => { if (live) live.g.volume(outVolume()); });
  bus.on('ambient:stop', () => stop());
  bus.on('tick:1s', checkSleep);
  /* a context made without a gesture (a focus session after a reload)
     starts on the next click or key */
  const poke = () => { if (live && live.ctx.state === 'suspended') live.ctx.resume().catch(() => {}); };
  window.addEventListener('pointerdown', poke, true);
  window.addEventListener('keydown', poke, true);
}

/* ---------------- playing ---------------------------------------- */
function ensureLive() {
  if (live) return live;
  let ctx;
  try { ctx = new AC({ latencyHint: 'playback' }); } catch (e) {
    try { ctx = new AC(); } catch (err) { return null; }
  }
  made.push(ctx);
  if (made.length > 4) made.shift();
  const g = makeGraph(ctx, { seed: (Math.random() * 2 ** 31) | 0, volume: outVolume(), fadeIn: 1.2 });
  const L = { ctx, g, tick: 0 };
  L.tick = setInterval(() => { if (live === L) { g.fill(ctx.currentTime + AHEAD); checkSleep(); } }, TICK_MS);
  live = L;
  return L;
}

export function play() {
  load();
  wire();
  if (!AC) {
    S.error = 'This browser has no Web Audio, so StaticOS can’t make these sounds here.';
    emit();
    return false;
  }
  if (!anyOn()) {                         /* nothing up: start from the last preset (or the first) */
    const p = PRESET_BY_ID.get(S.preset) || PRESETS[0];
    for (const x of SOUNDS) S.levels[x.id] = clamp01(p.mix[x.id]);
    S.preset = p.id;
    persist();
  }
  const L = ensureLive();
  if (!L) { S.error = 'The browser wouldn’t open an audio output.'; emit(); return false; }
  try { if (L.ctx.state === 'suspended') L.ctx.resume().catch(() => {}); } catch (e) { /* resumes on the next gesture */ }
  for (const x of SOUNDS) if (S.levels[x.id] > 0) L.g.set(x.id, S.levels[x.id]);
  L.g.fill(L.ctx.currentTime + AHEAD);
  S.playing = true;
  S.error = null;
  if (S.sleep) armSleep();
  emit();
  return true;
}

/** Fade out, then stop every source, disconnect every node, close the context. */
export function stop({ fade = 0.6 } = {}) {
  clearSleep();
  S.sleep = null;
  S.byFocus = false;
  const L = live;
  live = null;
  const was = S.playing;
  S.playing = false;
  if (L) {
    clearInterval(L.tick);
    const f = Math.max(0.02, Number(fade) || 0.02);
    L.g.fadeTo(0, f);
    closing.add(L);
    setTimeout(() => {
      L.g.close();
      try { const p = L.ctx.close(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* already closed */ }
      closing.delete(L);
    }, f * 1000 + 60);
  }
  if (was || L) emit();
}

export const toggle = () => (S.playing ? (stop(), false) : play());

/** One sound's level (0–1). Turning a sound up while nothing plays starts the mix. */
export function setLevel(id, level) {
  load();
  if (!BY_ID.has(id)) return;
  const v = clamp01(level);
  if (S.levels[id] === v) return;
  S.levels[id] = v;
  S.preset = matchPreset(S.levels);
  persist();
  if (live) {
    live.g.set(id, v);
    if (!anyOn()) { stop(); return; }
    live.g.fill(live.ctx.currentTime + AHEAD);
  } else if (v > 0) { play(); return; }
  emit();
}

/** A preset's mix (every other sound off), and play it. */
export function applyPreset(id) {
  load();
  const p = PRESET_BY_ID.get(id);
  if (!p) return false;
  for (const x of SOUNDS) S.levels[x.id] = clamp01(p.mix[x.id]);
  S.preset = p.id;
  persist();
  if (!live) return play();
  for (const x of SOUNDS) live.g.set(x.id, S.levels[x.id]);
  live.g.fill(live.ctx.currentTime + AHEAD);
  emit();
  return true;
}

/* ---------------- the sleep timer -------------------------------- */
let sleepTimers = [];
function clearSleep() { sleepTimers.forEach(clearTimeout); sleepTimers = []; }

/** 15, 30, 60 or 90 minutes from now; anything else turns the timer off. */
export function setSleep(minutes) {
  load();
  clearSleep();
  const m = Number(minutes);
  if (!SLEEP_CHOICES.includes(m)) {
    const was = S.sleep;
    S.sleep = null;
    if (was?.fading && live) live.g.fadeTo(1, 0.6);   /* changed your mind mid-fade */
    emit();
    return null;
  }
  if (S.sleep?.fading && live) live.g.fadeTo(1, 0.6);
  S.sleep = { minutes: m, endsAt: Date.now() + m * 60000, fading: false };
  if (!S.playing) play(); else { armSleep(); emit(); }
  return state().sleep;
}

function armSleep() {
  clearSleep();
  if (!S.sleep) return;
  const left = S.sleep.endsAt - Date.now();
  const fadeIn = left - FADE_S * 1000;
  if (fadeIn <= 0) beginFade();
  else sleepTimers.push(setTimeout(beginFade, fadeIn));
  sleepTimers.push(setTimeout(endSleep, Math.max(0, left)));
}
function beginFade() {
  if (!S.sleep || S.sleep.fading) return;
  S.sleep.fading = true;
  if (live) live.g.fadeTo(0, Math.max(0.05, (S.sleep.endsAt - Date.now()) / 1000));
  emit();
}
function endSleep() {
  if (!S.sleep) return;
  stop({ fade: 0.05 });
}
/* belt and braces for a tab the browser held back: the wall clock decides */
function checkSleep() {
  if (!S.sleep || !S.playing) return;
  const now = Date.now();
  if (now >= S.sleep.endsAt) endSleep();
  else if (!S.sleep.fading && now >= S.sleep.endsAt - FADE_S * 1000) beginFade();
}

/* ---------------- focus sessions --------------------------------- */
let focusMod = null;
let focusProbe = null;
let focusWas = false;
let inited = false;

/** Is the focus timer (Clock › Focus) part of this StaticOS? */
export function focusReady() {
  if (!focusProbe) {
    focusProbe = import('./focus.js').then(F => {
      focusMod = F;
      try { const st = F.state(); focusWas = st.phase === 'focus' && st.status === 'running'; } catch (e) { /* fine */ }
      return typeof F.state === 'function';
    }, () => false);
  }
  return focusProbe;
}

/* a page that has had no click or key can't start sound */
const gestured = () => (typeof navigator === 'undefined' || !navigator.userActivation || navigator.userActivation.hasBeenActive);

function onFocus(st) {
  const running = !!st && st.phase === 'focus' && st.status === 'running';
  const was = focusWas;
  focusWas = running;
  if (running === was || !focusPrefs().on) return;
  if (running) {
    if (S.playing || !gestured()) return;      /* yours already, or no gesture yet */
    applyPreset(focusPrefs().preset);
    S.byFocus = true;
    emit();
  } else if (S.byFocus && S.playing) {
    stop({ fade: 2.5 });
  }
}

export function setFocus(patch = {}) {
  load();
  const next = { ...focusPrefs() };
  if (patch.on !== undefined) next.on = !!patch.on;
  if (patch.preset !== undefined && PRESET_BY_ID.has(patch.preset)) next.preset = patch.preset;
  store.set(KEY, { ...saved(), v: 1, focus: next });
  if (next.on) init();
  emit();
  return next;
}

/** Listen for focus sessions. main.js calls it at start-up when the switch is on. */
export function init() {
  if (inited || typeof window === 'undefined') return;
  inited = true;
  load();
  wire();
  bus.on('focus:change', onFocus);
  focusReady();
}

/* ---------------- measuring -------------------------------------- */
/**
 * Render a mix offline: { rain: 0.7, ... }, `seconds` long, stereo 44.1 kHz.
 * opts: seed (repeatable), volume (1), fadeAt + fadeFor (a sleep-timer fade).
 */
export async function render(levels, seconds = 4, opts = {}) {
  if (!OAC) throw new Error('This browser has no OfflineAudioContext.');
  const rate = opts.rate || 44100;
  const c = new OAC(2, Math.ceil(seconds * rate), rate);
  const g = makeGraph(c, { seed: opts.seed ?? 7, volume: opts.volume ?? 1 });
  for (const x of SOUNDS) { const v = clamp01(levels?.[x.id]); if (v > 0) g.set(x.id, v); }
  if (opts.fadeAt != null) g.fadeTo(0, opts.fadeFor ?? 1, opts.fadeAt);
  g.fill(seconds);
  return c.startRendering();
}

/** The live graph as it stands (tests; nothing here changes it).
    { nodes: true } also hands over the nodes themselves, so a test can
    follow their connections. */
export function inspect({ nodes = false } = {}) {
  const L = live;
  const chans = {};
  if (L) {
    for (const [id, ch] of L.g.chans) {
      chans[id] = { level: ch.level, target: ch.target, value: ch.gain.gain.value, nodes: ch.nodes.length, sources: ch.srcs.length, grains: ch.grains };
      if (nodes) Object.assign(chans[id], { in: ch.in, gain: ch.gain, all: ch.nodes.slice() });
    }
  }
  const graph = nodes && L ? { ctx: L.ctx, mix: L.g.mix, comp: L.g.comp, master: L.g.master, fade: L.g.fade } : undefined;
  return {
    graph,
    ctx: L ? L.ctx.state : 'none',
    time: L ? L.ctx.currentTime : 0,
    master: L ? { target: L.g.masterTarget, value: L.g.master.gain.value } : null,
    fade: L ? { target: L.g.fadeTarget, value: L.g.fade.gain.value } : null,
    channels: chans,
    dropping: L ? [...L.g.dropping.keys()] : [],
    closing: closing.size,
    contexts: made.map(c => c.state),
  };
}

export default { SOUNDS, PRESETS, SLEEP_CHOICES, FADE_S, sounds, presets, state, play, stop, toggle, setLevel, applyPreset, setSleep, setFocus, focusReady, gainFor, render, inspect, init };
