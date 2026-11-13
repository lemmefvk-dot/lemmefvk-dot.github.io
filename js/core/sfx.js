/* ============================================================
   sfx.js — a subtle UI sound engine, fully synthesised.
   No audio files: every cue is a short OscillatorNode + GainNode
   envelope built at play time. UI sounds are on by default
   (prefs.uiSounds); the boot sounds have their own switch
   (prefs.bootSounds, also on). Both respect Mute and Volume.

   Settings › Sound (all read live, so a change is heard at once):
     prefs.uiSounds       the master switch for the cues below (on)
     prefs.soundPack      their voice: glass retro soft mech chime
     prefs.uiSoundVolume  their own level, 0–100 under the system
                          volume (100 — the level they were designed at)
     prefs.clickSounds    a tap when a button, tab or link is clicked,
                          a toggle cue for a switch (off: opt-in)
     prefs.notiSounds     the notify cue for a notification (on); never
                          in Do Not Disturb or for an app you silenced

   Start-up chime: prefs.bootChime (glass classic synth soft retro none),
   played once on bus 'boot:ready' — startup(), previewChime(id), CHIMES.

   Public surface:
     init()            wire the bus + arm a first-gesture unlock
     play(name)        one of: open close tap toggle notify error phase
     boot(name)        a boot cue: menu select post key ok seek startx
                       winchime chime; hum() starts the drive hum and
                       returns its stop()
     unlock()          resume audio from inside a key/pointer handler
     setEnabled(bool)  persist the on/off flag (prefs.uiSounds)
     setVolume(0..1)   runtime loudness scale (prefs.volume is the ceiling)
     PACKS, preview()  the UI cues come in voices (prefs.soundPack) —
                       the Store lists PACKS and previews each
     isEnabled()       true only when sounds are on AND not muted
     spooky(name, lvl) the seasonal pack: creak boo cackle (shell/spooky.js
                       decides when); claimed is the set of UI cues it is
                       voicing instead, so they don't play twice

   Every path no-ops safely: WebAudio may be missing, may throw, or
   (headless / no audio device) may create a context that never starts.
   ============================================================ */
import { bus } from './bus.js';
import { store } from './store.js';
import * as SUMMARY from './notisummary.js';

const AC = typeof window !== 'undefined'
  ? (window.AudioContext || window.webkitAudioContext) : null;

let ctx = null;        // lazily created on first gesture
let armed = false;     // gesture-unlock + bus wiring done once
let volScale = 1;      // setVolume(0..1) — multiplies the prefs ceiling

/* ---- preferences -------------------------------------------------- */
/* Read live each time so a Settings toggle takes effect immediately. */
const soundsOn = () => store.get('prefs.uiSounds', true) !== false;
const bootOn   = () => store.get('prefs.bootSounds', true) !== false;
const muted    = () => store.get('prefs.muted', false) === true;
/* prefs.volume is 0..100 (default 62); it is the loudness ceiling. */
const ceiling  = () => Math.max(0, Math.min(1, (store.get('prefs.volume', 62) || 0) / 100));
/* the UI cues' own level under that ceiling (Settings › Sound) */
const pct = (v, d) => { const n = Number(v); return Math.max(0, Math.min(100, Number.isFinite(n) ? n : d)) / 100; };
export const uiLevel = () => pct(store.get('prefs.uiSoundVolume', 100), 100);
const clicksOn = () => store.get('prefs.clickSounds', false) === true;
const notiOn   = () => store.get('prefs.notiSounds', true) !== false;

export function isEnabled() { return soundsOn() && !muted(); }

/* ---- context lifecycle -------------------------------------------- */
/* Browsers refuse to start audio before a user gesture, so the context
   is created suspended and only resumed from a real pointer/key event. */
function ensureCtx() {
  if (ctx || !AC) return ctx;
  try { ctx = new AC(); } catch (e) { ctx = null; }
  return ctx;
}

function resume() {
  const c = ensureCtx();
  if (c && c.state === 'suspended') { try { c.resume(); } catch (e) {} }
}


/* ---- the synthesised cues ----------------------------------------- */
/* Kept quiet (peak ~0.09 before the volume ceiling) and short (<=120ms).
   A tiny attack + exponential release avoids the click a hard gate makes. */
function tone(c, when, { type = 'sine', from, to = from, dur = 0.08, peak = 0.05, cut }) {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, when);
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), when + dur);

  let node = osc;
  if (cut) { // a lowpass keeps the "thud" muted rather than buzzy
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(cut, when);
    osc.connect(lp); node = lp;
  }

  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(peak, when + 0.006);         // soft attack
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);    // natural tail
  node.connect(g).connect(c.destination);
  osc.start(when);
  osc.stop(when + dur + 0.02);
}

/* Each recipe receives (ctx, t0, gain) where gain is the final scalar. */
const CUES = {
  open:   (c, t, v) => tone(c, t, { type: 'sine', from: 440, to: 660, dur: 0.09, peak: 0.05 * v }),
  close:  (c, t, v) => tone(c, t, { type: 'sine', from: 620, to: 400, dur: 0.09, peak: 0.05 * v }),
  tap:    (c, t, v) => tone(c, t, { type: 'triangle', from: 1200, dur: 0.03, peak: 0.035 * v }),
  toggle: (c, t, v) => tone(c, t, { type: 'triangle', from: 720, to: 900, dur: 0.05, peak: 0.04 * v }),
  notify: (c, t, v) => { // soft two-note chime
    tone(c, t, { type: 'sine', from: 660, dur: 0.10, peak: 0.045 * v });
    tone(c, t + 0.09, { type: 'sine', from: 880, dur: 0.12, peak: 0.05 * v });
  },
  error:  (c, t, v) => tone(c, t, { type: 'sine', from: 160, to: 110, dur: 0.11, peak: 0.06 * v, cut: 320 }),
  /* the focus timer's phase end (js/core/focus.js): two soft bells, in
     every pack — a pack without its own falls back to this one */
  phase:  (c, t, v) => { bell(c, t, 659.25, { dur: 1.1, peak: 0.035 * v }); bell(c, t + 0.22, 880, { dur: 1.3, peak: 0.032 * v }); },
};
CUES.click = CUES.tap; // alias

/* ---- sound packs --------------------------------------------------- */
/* The same six UI cues in different voices (prefs.soundPack, picked in
   the Store). 'glass' is CUES above; a pack only has to override the
   cues it changes. Boot cues are not part of a pack — the boot sound is
   the drive's, not the desktop's. */
const PACK_CUES = {
  glass: CUES,
  retro: {
    open:   (c, t, v) => { tone(c, t, { type: 'square', from: 523, dur: 0.05, peak: 0.022 * v, cut: 3600 }); tone(c, t + 0.05, { type: 'square', from: 784, dur: 0.06, peak: 0.022 * v, cut: 3600 }); tone(c, t, { type: 'triangle', from: 262, dur: 0.11, peak: 0.03 * v }); },
    close:  (c, t, v) => { tone(c, t, { type: 'square', from: 784, dur: 0.05, peak: 0.022 * v, cut: 3600 }); tone(c, t + 0.05, { type: 'square', from: 523, dur: 0.06, peak: 0.022 * v, cut: 3600 }); },
    tap:    (c, t, v) => tone(c, t, { type: 'square', from: 1568, dur: 0.02, peak: 0.016 * v, cut: 4000 }),
    toggle: (c, t, v) => tone(c, t, { type: 'square', from: 880, to: 1320, dur: 0.05, peak: 0.02 * v, cut: 4000 }),
    notify: (c, t, v) => { [659, 880, 1319].forEach((f, i) => tone(c, t + i * 0.07, { type: 'square', from: f, dur: 0.07, peak: 0.02 * v, cut: 3600 })); tone(c, t, { type: 'triangle', from: 330, dur: 0.22, peak: 0.03 * v }); },
    error:  (c, t, v) => { tone(c, t, { type: 'square', from: 196, dur: 0.08, peak: 0.028 * v, cut: 1400 }); tone(c, t + 0.09, { type: 'square', from: 147, dur: 0.12, peak: 0.028 * v, cut: 1400 }); },
    /* the focus timer's phase end: a four-note chiptune jingle over a triangle bass */
    phase:  (c, t, v) => { [523, 659, 784, 1046].forEach((f, i) => tone(c, t + i * 0.1, { type: 'square', from: f, dur: 0.1, peak: 0.02 * v, cut: 3600 })); tone(c, t, { type: 'triangle', from: 262, dur: 0.22, peak: 0.032 * v }); tone(c, t + 0.2, { type: 'triangle', from: 392, dur: 0.24, peak: 0.032 * v }); },
  },
  soft: {
    open:   (c, t, v) => tone(c, t, { type: 'sine', from: 330, to: 440, dur: 0.14, peak: 0.035 * v, cut: 1200 }),
    close:  (c, t, v) => tone(c, t, { type: 'sine', from: 440, to: 294, dur: 0.14, peak: 0.035 * v, cut: 1200 }),
    tap:    (c, t, v) => tone(c, t, { type: 'sine', from: 600, dur: 0.035, peak: 0.025 * v, cut: 1400 }),
    toggle: (c, t, v) => tone(c, t, { type: 'sine', from: 494, to: 587, dur: 0.08, peak: 0.03 * v, cut: 1400 }),
    notify: (c, t, v) => { bell(c, t, 523.25, { dur: 0.7, peak: 0.03 * v }); bell(c, t + 0.12, 659.25, { dur: 0.8, peak: 0.03 * v }); },
    error:  (c, t, v) => tone(c, t, { type: 'sine', from: 196, to: 147, dur: 0.18, peak: 0.045 * v, cut: 500 }),
  },
  mech: {
    open:   (c, t, v) => { noise(c, t, { dur: 0.014, peak: 0.04 * v, hp: 1200, lp: 6000 }); noise(c, t + 0.035, { dur: 0.01, peak: 0.025 * v, hp: 2000, lp: 8000 }); },
    close:  (c, t, v) => { noise(c, t, { dur: 0.01, peak: 0.025 * v, hp: 2000, lp: 8000 }); noise(c, t + 0.035, { dur: 0.016, peak: 0.04 * v, hp: 900, lp: 5000 }); },
    tap:    (c, t, v) => noise(c, t, { dur: 0.01, peak: 0.035 * v, hp: 1600, lp: 7500 }),
    toggle: (c, t, v) => { noise(c, t, { dur: 0.012, peak: 0.035 * v, hp: 1400, lp: 7000 }); tone(c, t, { type: 'sine', from: 160, dur: 0.03, peak: 0.02 * v, cut: 400 }); },
    notify: (c, t, v) => { noise(c, t, { dur: 0.012, peak: 0.03 * v, hp: 1500, lp: 7000 }); bell(c, t + 0.03, 1760, { dur: 0.5, peak: 0.02 * v, type: 'triangle' }); },
    error:  (c, t, v) => { noise(c, t, { dur: 0.03, peak: 0.05 * v, hp: 300, lp: 1800 }); tone(c, t, { type: 'sine', from: 110, dur: 0.1, peak: 0.04 * v, cut: 300 }); },
  },
  chime: {
    open:   (c, t, v) => bell(c, t, 1046.5, { dur: 0.5, peak: 0.028 * v }),
    close:  (c, t, v) => bell(c, t, 784, { dur: 0.45, peak: 0.024 * v }),
    tap:    (c, t, v) => bell(c, t, 2093, { dur: 0.18, peak: 0.014 * v }),
    toggle: (c, t, v) => bell(c, t, 1318.5, { dur: 0.3, peak: 0.022 * v }),
    notify: (c, t, v) => [1046.5, 1318.5, 1568].forEach((f, i) => bell(c, t + i * 0.08, f, { dur: 0.9, peak: 0.024 * v })),
    error:  (c, t, v) => { bell(c, t, 466.16, { dur: 0.6, peak: 0.03 * v }); bell(c, t + 0.1, 440, { dur: 0.7, peak: 0.03 * v }); },
  },
};

/* what the Store lists — the ids are the prefs.soundPack values */
export const PACKS = [
  { id: 'glass', name: 'Glass', note: 'The default: short sine sweeps, barely there.' },
  { id: 'retro', name: '8-Bit', note: 'Square-wave blips from a console that never existed.' },
  { id: 'soft', name: 'Felt', note: 'Low, muffled and rounded. For late nights.' },
  { id: 'mech', name: 'Switches', note: 'Clicks and clacks, like a mechanical keyboard.' },
  { id: 'chime', name: 'Chimes', note: 'Every action rings a small glass bell.' },
];
/* What a pack voices itself, for tests: the cue names it has its own recipe for,
   and the recipe itself (so a test can run it against an offline context). */
export const CUE_NAMES = ['open', 'close', 'tap', 'toggle', 'notify', 'error'];
export const packCueNames = id => (PACK_CUES[id] ? Object.keys(PACK_CUES[id]) : []);
export const packCue = (id, name) => (PACK_CUES[id] && PACK_CUES[id][name]) || null;
const packId = () => (PACK_CUES[store.get('prefs.soundPack')] ? store.get('prefs.soundPack') : 'glass');
const cueFor = (name, pack = packId()) => (PACK_CUES[pack] && PACK_CUES[pack][name]) || CUES[name];

/* ---- play --------------------------------------------------------- */
/* UI cues a seasonal pack is voicing instead (js/shell/spooky.js adds
   'open' and 'notify' while the spooky sounds are on), so a window opening
   creaks rather than creaking AND chiming. Empty the rest of the year. */
export const claimed = new Set();

/* UI cues decided on, as 'pack:cue' (sound on, not claimed, level above
   zero) — whether or not this device could play them. Like `asked` for the
   spooky pack: a machine with no audio output still shows the decision. */
export const decided = [];

export function play(name) {
  if (!isEnabled()) return false;        // off or muted → nothing
  const key = name === 'click' ? 'tap' : name;
  if (claimed.has(key)) return false;    // a seasonal pack is voicing this one
  /* a notification tone from the advent calendar stands in for the pack's own */
  const toneId = key === 'notify' && Object.hasOwn(TONES, store.get('prefs.notiTone') || '') ? store.get('prefs.notiTone') : null;
  const pack = toneId ? `tone:${toneId}` : packId();
  const cue = toneId ? TONES[toneId] : cueFor(key, pack);
  if (!cue) return false;
  const v = ceiling() * volScale * uiLevel();
  if (v <= 0) return false;
  decided.push(`${pack}:${key}`);
  if (decided.length > 200) decided.splice(0, 100);
  const c = ensureCtx();
  if (!c) return false;                  // no WebAudio here
  try {
    if (c.state === 'suspended') c.resume();  // may still be gated; harmless
    if (c.state !== 'running') return false;  // no device / not unlocked yet
    cue(c, c.currentTime + 0.001, v);
    played.push(`ui:${pack}:${key}`);
    if (played.length > 200) played.splice(0, 100);
    return true;
  } catch (e) { return false; /* audio can throw at any point — never surface it */ }
}

/* ---- boot cues ----------------------------------------------------- */
/* A short burst of filtered noise: key clicks, drive seeks. */
function noise(c, when, { dur = 0.012, peak = 0.03, hp = 1500, lp = 7000 }) {
  const len = Math.max(1, Math.ceil(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f1 = c.createBiquadFilter(); f1.type = 'highpass'; f1.frequency.value = hp;
  const f2 = c.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = lp;
  const g = c.createGain(); g.gain.value = peak;
  src.connect(f1).connect(f2).connect(g).connect(c.destination);
  src.start(when);
}

/* a soft pad note with a long tail, for the chimes */
function bell(c, when, freq, { dur = 1.4, peak = 0.05, type = 'sine' } = {}) {
  tone(c, when, { type, from: freq, dur, peak });
  tone(c, when, { type: 'sine', from: freq * 2.001, dur: dur * 0.6, peak: peak * 0.25 });   /* a little shimmer */
}

/* ---- notification tones (the advent calendar's sound treats) -------
   js/core/winter.js gives one behind four of its doors; once you have it,
   prefs.notiTone set to its id plays it for every notification instead of
   the pack's chime, all year. Mute, the volume and Settings › Sound apply
   as to any cue. Original little figures, synthesised like the rest. */
export const TONES = {
  /* a shake of small bells: bright clinks over a hiss of jingle */
  'sleigh-bells': (c, t, v) => {
    for (let i = 0; i < 8; i++) {
      const at = t + i * 0.05 + (i % 2) * 0.012;
      noise(c, at, { dur: 0.045, peak: 0.018 * v, hp: 5500, lp: 12000 });
      bell(c, at, 2637 + (i % 3) * 233, { dur: 0.22, peak: 0.011 * v, type: 'triangle' });
    }
  },
  /* a wound-up comb plucking five notes */
  'music-box': (c, t, v) => [1046.5, 1318.5, 1568, 1318.5, 2093].forEach((f, i) =>
    bell(c, t + i * 0.12, f, { dur: 1.1, peak: 0.022 * v, type: 'triangle' })),
  /* three hand bells, high to low */
  'carol-bells': (c, t, v) => [1174.7, 987.8, 784].forEach((f, i) =>
    bell(c, t + i * 0.17, f, { dur: 1.5, peak: 0.03 * v })),
  /* glassy, scattered, very high */
  'icicle-chimes': (c, t, v) => [2349.3, 3136, 2637, 3520, 2793.8].forEach((f, i) =>
    bell(c, t + i * 0.07 + (i % 2) * 0.03, f, { dur: 0.9, peak: 0.014 * v })),
};

/** Hear a notification tone once (a Settings preview or the advent calendar).
    Respects Mute; called from a click, so it may unlock audio itself. */
export function previewTone(id) {
  if (muted() || !Object.hasOwn(TONES, id)) return false;
  const v = ceiling() * volScale * uiLevel();
  const c = ensureCtx();
  if (!c || v <= 0) return false;
  try {
    if (c.state === 'suspended') c.resume();
    TONES[id](c, c.currentTime + 0.02, v);
    played.push(`tone:${id}`);
    if (played.length > 200) played.splice(0, 100);
    return true;
  } catch (e) { return false; }
}

const BOOT = {
  /* the boot menu: a BIOS-ish tick to move, a double beep to boot */
  menu:   (c, t, v) => tone(c, t, { type: 'square', from: 980, dur: 0.025, peak: 0.022 * v, cut: 3000 }),
  select: (c, t, v) => {
    tone(c, t, { type: 'square', from: 660, dur: 0.05, peak: 0.028 * v, cut: 3000 });
    tone(c, t + 0.07, { type: 'square', from: 990, dur: 0.07, peak: 0.028 * v, cut: 3000 });
  },
  /* the one short beep a PC gives when its self-test passes */
  post:   (c, t, v) => tone(c, t, { type: 'square', from: 1000, dur: 0.14, peak: 0.025 * v, cut: 2400 }),
  /* typing: a click with a slightly different weight each time */
  key:    (c, t, v) => {
    noise(c, t, { dur: 0.012, peak: (0.025 + Math.random() * 0.02) * v, hp: 1400 + Math.random() * 600, lp: 7000 });
    tone(c, t, { type: 'sine', from: 140 + Math.random() * 40, dur: 0.02, peak: 0.012 * v, cut: 400 });
  },
  ok:     (c, t, v) => tone(c, t, { type: 'triangle', from: 1760, dur: 0.018, peak: 0.01 * v }),
  seek:   (c, t, v) => noise(c, t, { dur: 0.018, peak: 0.02 * v, hp: 500, lp: 2600 }),
  /* the desktop arriving: a filtered noise sweep under a rising tone */
  startx: (c, t, v) => {
    const len = Math.ceil(c.sampleRate * 0.7);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / len);
    const src = c.createBufferSource(); src.buffer = buf;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(300, t); lp.frequency.exponentialRampToValueAtTime(4200, t + 0.65);
    const g = c.createGain(); g.gain.value = 0.03 * v;
    src.connect(lp).connect(g).connect(c.destination); src.start(t);
    tone(c, t + 0.1, { type: 'sine', from: 220, to: 440, dur: 0.6, peak: 0.03 * v });
  },
  /* Windows drive: an original warm four-note rise (not Microsoft's sound) */
  winchime: (c, t, v) => {
    [[311.13, 0], [466.16, 0.16], [622.25, 0.32], [783.99, 0.5]].forEach(([f, dt], i) =>
      bell(c, t + dt, f, { dur: 1.9 - i * 0.2, peak: 0.045 * v, type: i % 2 ? 'triangle' : 'sine' }));
  },
  /* the hidden 'signal' boot: an untuned TV — hiss that thins out as the
     channel comes in */
  static: (c, t, v) => {
    const dur = 2.6;
    const len = Math.ceil(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(); src.buffer = buf;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 350;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.03 * v, t + 0.05);
    g.gain.linearRampToValueAtTime(0.018 * v, t + 1.9);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(hp).connect(g).connect(c.destination); src.start(t);
  },
  /* StaticOS: a quick glassy arpeggio for the diamond */
  chime: (c, t, v) => {
    [1046.5, 1318.5, 1568, 2093].forEach((f, i) => bell(c, t + i * 0.07, f, { dur: 1.1, peak: 0.03 * v }));
  },
};

/* what played, most recent last — for tests and debugging */
export const played = [];
/* spooky cues asked for (not muted, volume above zero), whether or not this
   device could actually play them — a machine with no audio output still
   shows the decision was made */
export const asked = [];
/** 'running' | 'suspended' | 'closed' | 'none' — is there sound here at all? */
export const audioState = () => (ctx ? ctx.state : 'none');

export function boot(name) {
  if (!bootOn() || muted()) return;
  if (name === 'chime') return;        /* the splash's chime is now the start-up chime (startup() below), once the desktop is up */
  const cue = BOOT[name];
  if (!cue) return;
  const v = ceiling() * volScale;
  if (v <= 0) return;
  const c = ensureCtx();
  if (!c) return;
  try {
    if (c.state === 'suspended') c.resume();
    if (c.state !== 'running') return;          /* not unlocked by a gesture yet */
    cue(c, c.currentTime + 0.001, v);
    played.push(name);
    if (played.length > 200) played.splice(0, 100);
  } catch (e) { /* never surface audio errors */ }
}

/* the drive hum under the Linux kernel log: returns stop() */
export function hum() {
  const stopNothing = () => {};
  if (!bootOn() || muted()) return stopNothing;
  const v = ceiling() * volScale;
  const c = ensureCtx();
  if (!c || v <= 0) return stopNothing;
  try {
    if (c.state === 'suspended') c.resume();
    if (c.state !== 'running') return stopNothing;
    const len = c.sampleRate * 2;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }  /* brown noise */
    const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
    const g = c.createGain();
    const t = c.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05 * v, t + 0.6);
    src.connect(lp).connect(g).connect(c.destination);
    src.start(t);
    played.push('hum');
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      try {
        const n = c.currentTime;
        g.gain.cancelScheduledValues(n);
        g.gain.setValueAtTime(g.gain.value, n);
        g.gain.linearRampToValueAtTime(0.0001, n + 0.5);
        src.stop(n + 0.55);
      } catch (e) {}
    };
  } catch (e) { return stopNothing; }
}

/* ---- the spooky pack ------------------------------------------------
   Seasonal (js/core/season.js): a hinge creak when a window opens, a
   ghostly "boo" for a notification, a witch's cackle when the Trash is
   emptied. Off unless prefs.spookySounds is on; js/shell/spooky.js decides
   when to call spooky(). Synthesised here like every other cue — a stick-
   slip impulse train through wood resonances, a sawtooth voice through
   vowel formants — so there are no recordings to license or download.

   Each recipe takes any BaseAudioContext, so an OfflineAudioContext can
   render one for a test or a waveform, and an optional destination node
   (the context's speakers by default) — js/core/ambient.js plays the
   creak into its own mixer. */

/* a bank of band-pass "formants" a voice or a hinge is filtered through */
function formants(c, src, bands, out) {
  for (const [fr, q, g] of bands) {
    const bp = c.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.value = fr; bp.Q.value = q;
    const gg = c.createGain(); gg.gain.value = g;
    src.connect(bp).connect(gg).connect(out);
  }
}

/* white noise for breath, made once per context */
const noiseFor = new WeakMap();
function noiseBuf(c) {
  let b = noiseFor.get(c);
  if (b) return b;
  const len = Math.ceil(c.sampleRate * 1.5);
  b = c.createBuffer(1, len, c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  noiseFor.set(c, b);
  return b;
}

/* one sung syllable: a sawtooth voice with a little breath, through vowel
   formants, under its own envelope */
function syllable(c, t, { f0, to = f0, dur, vowel, peak, vib = 0, breath = 0.18, dest }) {
  const out = c.createGain();
  out.gain.setValueAtTime(0.0001, t);
  out.gain.linearRampToValueAtTime(peak, t + Math.min(0.012, dur * 0.2));
  out.gain.setValueAtTime(peak, t + dur * 0.55);
  out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  out.connect(dest);

  const osc = c.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(40, to), t + dur);
  if (vib) {
    const lfo = c.createOscillator(); lfo.frequency.value = 6.2;
    const amt = c.createGain(); amt.gain.value = f0 * vib;
    lfo.connect(amt).connect(osc.frequency);
    lfo.start(t); lfo.stop(t + dur + 0.02);
  }
  const voice = c.createGain(); voice.gain.value = 1;
  osc.connect(voice);
  const air = c.createBufferSource(); air.buffer = noiseBuf(c);
  const airG = c.createGain();
  /* the "h" in front of each syllable, then a thread of breath under it */
  airG.gain.setValueAtTime(breath * 2.4, t);
  airG.gain.exponentialRampToValueAtTime(Math.max(0.0001, breath * 0.4), t + Math.min(0.05, dur * 0.5));
  air.connect(airG).connect(voice);
  formants(c, voice, vowel, out);
  osc.start(t); osc.stop(t + dur + 0.02);
  air.start(t, Math.random()); air.stop(t + dur + 0.02);
}

const VOWEL = {
  a: [[800, 7, 1], [1250, 8, 0.55], [2650, 10, 0.18]],   /* "ah" */
  e: [[560, 7, 1], [1850, 9, 0.45], [2600, 10, 0.2]],    /* "eh" */
  i: [[330, 8, 0.8], [2300, 10, 0.5], [3000, 12, 0.25]], /* "ee" */
  u: [[320, 6, 1], [800, 8, 0.32], [2400, 10, 0.06]],    /* "oo" */
};

export const SPOOKY = {
  /* a hinge: stick-slip clicks whose rate glides up and back down, ringing
     a few wooden resonances — about 0.9 s */
  creak(c, t, v, dest = c.destination) {
    const sr = c.sampleRate, dur = 0.9, len = Math.ceil(sr * dur);
    const buf = c.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    const click = Math.max(4, Math.round(sr * 0.00038));   /* ~0.4 ms, whatever the sample rate */
    for (let at = 0; at < len;) {
      const p = at / len;
      const rate = 34 + 78 * Math.sin(Math.PI * Math.min(1, p * 1.25)) ** 1.4 - 12 * p;  /* clicks per second */
      const amp = Math.sin(Math.PI * p) ** 0.5 * (0.55 + 0.45 * Math.random());
      for (let k = 0; k < click && at + k < len; k++) d[at + k] += amp * (1 - k / click) * (k & 1 ? -1 : 1);
      at += Math.max(6, Math.round((sr / rate) * (0.82 + Math.random() * 0.36)));
    }
    const src = c.createBufferSource(); src.buffer = buf;
    const out = c.createGain(); out.gain.value = CAL.creak * v;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3600;
    formants(c, src, [[520, 10, 1], [1180, 14, 0.7], [2350, 16, 0.4], [160, 4, 0.5]], lp);
    lp.connect(out).connect(dest);
    src.start(t);
  },

  /* a ghost: "boooOOooo" — a low "oo" that swells, wavers and sinks, with a
     thin whistle above it and an echo behind */
  boo(c, t, v) {
    const dur = 1.3;
    const echo = c.createDelay(1); echo.delayTime.value = 0.21;
    const fb = c.createGain(); fb.gain.value = 0.32;
    const wet = c.createGain(); wet.gain.value = 0.45;
    const dry = c.createGain(); dry.gain.value = CAL.boo;
    dry.connect(c.destination);
    dry.connect(echo); echo.connect(fb).connect(echo); echo.connect(wet).connect(c.destination);

    /* the "b": the lips open, so the voice brightens over the first 70 ms */
    const lips = c.createBiquadFilter(); lips.type = 'lowpass';
    lips.frequency.setValueAtTime(240, t);
    lips.frequency.exponentialRampToValueAtTime(1300, t + 0.07);
    lips.Q.value = 0.9;
    lips.connect(dry);
    syllable(c, t, { f0: 150, to: 118, dur, vowel: VOWEL.u, peak: v, vib: 0.035, breath: 0.12, dest: lips });

    /* the whistle */
    const w = c.createOscillator(); w.type = 'sine';
    w.frequency.setValueAtTime(520, t + 0.1);
    w.frequency.linearRampToValueAtTime(610, t + 0.5);
    w.frequency.linearRampToValueAtTime(430, t + dur);
    const lfo = c.createOscillator(); lfo.frequency.value = 4.6;
    const amt = c.createGain(); amt.gain.value = 14;
    lfo.connect(amt).connect(w.frequency);
    const wg = c.createGain();
    wg.gain.setValueAtTime(0.0001, t + 0.1);
    wg.gain.linearRampToValueAtTime(CAL.whistle * v, t + 0.5);
    wg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    w.connect(wg).connect(c.destination);
    w.start(t + 0.1); w.stop(t + dur + 0.02);
    lfo.start(t + 0.1); lfo.stop(t + dur + 0.02);
  },

  /* a witch: "heh-heh-heh-HA-ha-ha-ha-heeee" — fast falsetto syllables that
     climb, tumble back down and end on a long wavering "ee" */
  cackle(c, t, v) {
    const bus = c.createGain(); bus.gain.value = 1;
    /* a touch of grit in the throat */
    const shaper = c.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) { const x = (i / (curve.length - 1)) * 2 - 1; curve[i] = Math.tanh(2.2 * x) / Math.tanh(2.2); }
    shaper.curve = curve;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 220;
    const out = c.createGain(); out.gain.value = CAL.cackle * v;
    bus.connect(shaper).connect(hp).connect(out).connect(c.destination);

    const pitches = [560, 600, 650, 720, 690, 650, 610, 575];
    let at = t;
    pitches.forEach((p, i) => {
      const dur = 0.085 + Math.random() * 0.025;
      const f0 = p * (0.97 + Math.random() * 0.06);
      syllable(c, at, { f0, to: f0 * 0.86, dur, vowel: i < 3 ? VOWEL.e : VOWEL.a, peak: 1, breath: 0.3, dest: bus });
      at += dur + 0.04 + Math.random() * 0.025;
    });
    syllable(c, at + 0.02, { f0: 640, to: 470, dur: 0.75, vowel: VOWEL.i, peak: 0.95, vib: 0.06, breath: 0.22, dest: bus });
  },
};

/* loudness trims, measured by rendering each recipe in an OfflineAudioContext
   so all three peak near 0.22 × v — a little above the UI cues (≈0.1), since
   these are meant to be noticed. tests/suites/halloween-theme.mjs re-measures. */
const CAL = { creak: 18, boo: 0.5, whistle: 0.03, cackle: 0.21 };

/**
 * Play a spooky cue at `level` (0–1, the pack's own volume). Obeys Mute and
 * the system volume like every cue; does NOT need prefs.uiSounds — the pack
 * has its own switch, checked by the caller. Returns true if it played.
 * `gesture`: called from a click (a Settings preview), so a context that is
 * still resuming will start in a moment — schedule anyway rather than drop it.
 */
export function spooky(name, level = 1, gesture = false) {
  if (muted() || !Object.hasOwn(SPOOKY, name)) return false;
  const v = ceiling() * volScale * Math.max(0, Math.min(1, level));
  if (v <= 0) return false;
  asked.push(name);
  if (asked.length > 200) asked.splice(0, 100);
  const c = ensureCtx();
  if (!c) return false;
  try {
    if (c.state === 'suspended') c.resume();
    /* not unlocked by a gesture yet: a cue queued now would go off later, at a random moment */
    if (c.state !== 'running' && !gesture) return false;
    SPOOKY[name](c, c.currentTime + 0.01, v);
    played.push(`spooky:${name}`);
    if (played.length > 200) played.splice(0, 100);
    return true;
  } catch (e) { return false; }
}

/** Resume audio from inside a real key or pointer handler — the boot menu
    swallows keys before the global unlock listener would see them. */
export function unlock() { resume(); }

/* ---- the start-up chime -------------------------------------------- */
/* What StaticOS plays once the desktop is up (prefs.bootChime, picked in
   Settings › Sound; 'glass', the diamond's own arpeggio, is the default). It sits under the existing
   prefs.bootSounds switch, Mute and the volume, and it never forces audio
   open: when the browser has not allowed sound yet it stays silent and
   startupInfo.state says 'blocked' for Settings to explain. All original,
   all synthesised as they play. */
const STARTUP = {
  /* the StaticOS diamond's glassy arpeggio, the sound the splash always had */
  glass: (c, t, v) => BOOT.chime(c, t, v),
  /* a warm struck chord, nearly together */
  classic: (c, t, v) => [146.83, 220, 293.66, 369.99].forEach((f, i) => bell(c, t + i * 0.035, f, { dur: 2.2 - i * 0.2, peak: 0.04 * v, type: i % 2 ? 'sine' : 'triangle' })),
  /* a filtered saw arpeggio, like a pad opening */
  synth: (c, t, v) => [110, 165, 220, 330, 440].forEach((f, i) => {
    tone(c, t + i * 0.12, { type: 'sawtooth', from: f, dur: 1.5, peak: 0.018 * v, cut: 900 + i * 350 });
    tone(c, t + i * 0.12, { type: 'sawtooth', from: f * 1.006, dur: 1.5, peak: 0.012 * v, cut: 900 + i * 350 });
  }),
  /* two slow, round notes */
  soft: (c, t, v) => [[523.25, 0], [783.99, 0.38]].forEach(([f, dt], i) => bell(c, t + dt, f, { dur: 2 - i * 0.3, peak: 0.032 * v })),
  /* an 8-bit run up and a held top note */
  retro: (c, t, v) => {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(c, t + i * 0.09, { type: 'square', from: f, dur: i === 3 ? 0.5 : 0.1, peak: 0.02 * v, cut: 3600 }));
  },
};
export const CHIMES = [
  { id: 'glass',   name: 'Glass',   note: 'Three bright bells climbing.' },
  { id: 'classic', name: 'Classic', note: 'A warm chord, struck almost together.' },
  { id: 'synth',   name: 'Synth',   note: 'A pad opening in a rising run.' },
  { id: 'soft',    name: 'Soft',    note: 'Two slow, round notes.' },
  { id: 'retro',   name: 'Retro',   note: 'An 8-bit run up to a held note.' },
  { id: 'none',    name: 'None',    note: 'Silent start-up.' },
];
export const chimeId = () => { const v = String(store.get('prefs.bootChime', 'glass')); return CHIMES.some(c => c.id === v) ? v : 'none'; };

/** What the last start-up chime did: 'idle' | 'played' | 'none' | 'off' | 'muted' | 'blocked' | 'unsupported' */
export const startupInfo = { state: 'idle', chime: 'none' };

/** Play the chosen chime now (called when the desktop is up). Never forces audio open. */
export function startup() {
  const id = chimeId();
  startupInfo.chime = id;
  const done = state => { startupInfo.state = state; return state; };
  if (id === 'none') return done('none');
  if (!bootOn()) return done('off');
  const v = ceiling() * volScale;
  if (muted() || v <= 0) return done('muted');
  const c = ensureCtx();
  if (!c) return done('unsupported');
  try {
    if (c.state === 'suspended') c.resume();     /* allowed only if the browser lets this page make sound */
    if (c.state !== 'running') return done('blocked');
    STARTUP[id](c, c.currentTime + 0.05, v);
    played.push(`startup:${id}`);
    if (played.length > 200) played.splice(0, 100);
    return done('played');
  } catch (e) { return done('unsupported'); }
}

/** Hear a chime from Settings. Called from a click, so it may unlock audio itself; respects Mute and volume, not the boot-sounds switch. */
export function previewChime(id) {
  if (id === 'none' || !Object.hasOwn(STARTUP, id) || muted()) return false;
  const v = ceiling() * volScale;
  const c = ensureCtx();
  if (!c || v <= 0) return false;
  try {
    if (c.state === 'suspended') c.resume();
    STARTUP[id](c, c.currentTime + 0.03, v);
    played.push(`startup-preview:${id}`);
    return true;
  } catch (e) { return false; }
}

/* ---- settings hooks ----------------------------------------------- */
export function setEnabled(on) {
  store.set('prefs.uiSounds', !!on);     // boolean primitive persists fine
  if (on) resume();                      // usually called from a click gesture
}

/* Play a pack's open + notify cues so it can be heard before it is chosen.
   Called from a click, so it may unlock audio itself; it still respects
   Mute, but not the UI-sounds switch (hearing a pack is the point). */
export function preview(pack) {
  if (muted() || !PACK_CUES[pack]) return false;
  const v = ceiling() * volScale * uiLevel();
  const c = ensureCtx();
  if (!c || v <= 0) return false;
  try {
    if (c.state === 'suspended') c.resume();
    const t = c.currentTime + 0.02;
    cueFor('open', pack)(c, t, v);
    cueFor('tap', pack)(c, t + 0.28, v);
    cueFor('notify', pack)(c, t + 0.5, v);
    played.push(`preview:${pack}`);
    return true;
  } catch (e) { return false; }
}

export function setVolume(v) {
  volScale = Math.max(0, Math.min(1, Number(v)));
  return volScale;
}

/* ---- wiring ------------------------------------------------------- */
/* init() is idempotent. It arms a one-shot gesture unlock (browsers only
   let audio start after a real interaction) and subscribes the OS events
   the shell already emits. Doing the subscribe here — not at import —
   keeps a bare import side-effect-free. */
export function init() {
  if (armed || typeof window === 'undefined') return;
  armed = true;

  const unlock = () => {
    resume();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock);

  bus.on('boot:ready', () => startup());     /* the desktop is up: the chosen start-up chime */
  bus.on('win:open',  () => play('open'));
  bus.on('win:close', () => play('close'));
  bus.on('noti:push', n => { if (notiWanted(n)) play('notify'); });

  /* Click sounds (opt-in): one listener for the whole page, in the capture
     phase so an app that stops propagation still gets its tap. A keyboard
     Enter/Space on a button is a click too, so it is heard the same way. */
  window.addEventListener('click', onClick, true);
}

/* A notification is heard only when it would be seen: not in Do Not
   Disturb, not from an app silenced in Settings › Notifications, and not
   for a progress notification re-sent under its key (an update, not news). */
const heardKeys = new Set();
function notiWanted(n) {
  if (n?.quiet === true) return false;   /* it rings its own cue (the focus timer's 'phase') */
  if (!notiOn() || store.get('prefs.dnd')) return false;
  const app = String(n?.appId || n?.app || '').toLowerCase();
  if (SUMMARY.holds(n, app)) return false;   /* waits for the summary card, which rings once */
  if (app && (store.get('prefs.notiApps', {}) || {})[app] === false) return false;
  if (n?.key) { if (heardKeys.has(n.key)) return false; heardKeys.add(n.key); }
  return true;
}

/* What counts as a control. Instruments (Piano, Beats) and anything else
   that makes its own sound opt out with data-sfx="off" on an ancestor. */
const CONTROL = 'button, [role="button"], [role="switch"], [role="tab"], [role="menuitem"], [role="option"], a[href], summary, select, input[type="checkbox"], input[type="radio"], .desk-icon';
let lastClick = 0;
function onClick(e) {
  if (!clicksOn() || !e.isTrusted) return;
  const t = e.target instanceof Element ? e.target : null;
  const el = t && t.closest(CONTROL);
  if (!el || el.disabled || el.closest('[data-sfx="off"]')) return;
  const now = performance.now();
  if (now - lastClick < 40) return;      /* one click, one tap — even through a label */
  lastClick = now;
  play(el.getAttribute('role') === 'switch' || el.matches('input[type="checkbox"]') ? 'toggle' : 'tap');
}

export default { CUE_NAMES, packCueNames, packCue, init, play, boot, startup, previewChime, CHIMES, startupInfo, hum, unlock, played, decided, setEnabled, setVolume, isEnabled, uiLevel, preview, PACKS, spooky, SPOOKY, claimed, TONES, previewTone };
