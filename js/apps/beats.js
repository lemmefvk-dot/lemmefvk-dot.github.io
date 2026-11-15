/* ============================================================
   beats.js — Static Beats: a step-sequencer drum machine.

   Every voice is synthesised at play time from oscillators and a
   single reusable white-noise buffer — there are no samples. Eight
   instruments (kick, snare, clap, closed/open hi-hat, tom, rim,
   cowbell) run down a grid of 8 to 32 steps, straight (four to a beat)
   or in triplets (three to a beat); click a cell to place a hit, drag
   to paint a run. Each hit is soft, medium or loud (pick the level, then
   paint), and each row has its own pitch and decay.

   Timing is real. A lookahead scheduler (Chris Wilson's "two clocks"
   pattern) reads the AudioContext's own clock: every 25 ms it queues
   any steps that fall inside the next ~120 ms, so the groove stays
   rock-steady no matter how busy the main thread is. BPM, swing and
   per-row volume/mute feed that scheduler live. A requestAnimation-
   Frame loop lights the playhead and the beat pulse from the same
   audio clock, so what moves is what you actually hear, not a guess.

   Melody: a piano roll under the drums (Drums | Melody) plays notes
   through the Static Synth's engine (js/core/synth.js) on the same clock.

   Output honestly follows the system Volume and Mute (prefs.volume /
   prefs.muted); a DynamicsCompressor on the bus keeps a full pattern
   from clipping. Export bounces the loop through an OfflineAudioContext
   and writes a real 16-bit WAV into ~/Music via core/media.js — it then
   opens in the Music app for real (and Static Studio and Soundboard read
   the same files). Stems write one WAV per row into a folder there, MIDI
   writes a .mid (drums on channel 10, the melody on its own track), and
   "Send to Soundboard" saves the loop and hands the file over.
   Patterns save to store 'portal.beats'; the plain data side (levels,
   rotate, random, the genre presets, MIDI tracks) is js/core/beatsmodel.js.

   Song mode chains saved patterns into a whole song: an ordered list
   of { pattern, times }, edited with add / remove / move up and down /
   duplicate and a repeat count per entry; it can loop. Each pattern keeps
   its own tempo, swing, length, levels and mutes. The song plays through
   the same lookahead scheduler, one bar at a time, with a marker on the
   entry being heard (from the audio clock) and a bar over the whole
   song. Export song renders it through the same OfflineAudioContext path
   as the loop, exactly as long as the song. A pattern deleted from the
   library stays in the song by name, says so, and is skipped.

   Jam: a room code (js/core/pair.js, kind 'beats') puts two friends on
   the same grid. Edits go across as small validated messages
   (js/core/instpair.js); each side plays by its own clock.

   Teardown stops the scheduler + the draw loop, cancels the store
   subscriptions and the autosave timer, leaves the room and closes the
   AudioContext.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as media from '../core/media.js';
import { createSynth, PRESETS as SYNTH_PRESETS } from '../core/synth.js';
import { writeSMF } from '../core/midi.js';
import { openPair } from '../core/pair.js';
import { isCode, normalizeCode, spaced } from '../core/roomcode.js';
import { BEATS_TYPES, limiter } from '../core/instpair.js';
import { invitePanel } from '../core/friendinvite.js';
import * as M from '../core/beatsmodel.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-beats-css')) {
  const l = document.createElement('link');
  l.id = 'feat-beats-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-beats.css';
  document.head.appendChild(l);
}

const LOOKAHEAD_MS = 25;      /* how often the scheduler wakes */
const AHEAD_S = 0.12;         /* how far ahead it queues notes */
const { clamp, IDS, LEVEL_GAIN, LEVEL_NAMES, LEN_MIN, LEN_MAX } = M;

/* The eight voices, in row order. `peak` balances one voice against the
   others before the per-row gain and the bus compressor. */
const INSTRUMENTS = [
  { id: 'kick',    name: 'Kick',     peak: 1.0 },
  { id: 'snare',   name: 'Snare',    peak: 0.9 },
  { id: 'clap',    name: 'Clap',     peak: 0.9 },
  { id: 'hat',     name: 'Hi-Hat',   peak: 0.7 },
  { id: 'ohat',    name: 'Open Hat', peak: 0.6 },
  { id: 'tom',     name: 'Tom',      peak: 0.85 },
  { id: 'rim',     name: 'Rim',      peak: 0.7 },
  { id: 'cowbell', name: 'Cowbell',  peak: 0.6 },
];

/* --- the synthesis. Each voice is context-agnostic: it builds its
   nodes on whichever AudioContext it is handed (live or offline) and
   plays into `out` (a per-row gain). `nb` is that context's noise buffer.
   x = { p: pitch ratio, d: decay multiplier } for the row (1 and 1 = as designed). */
const X0 = { p: 1, d: 1 };
const VOICES = {
  kick(ac, t, out, nb, v, x = X0) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(150 * x.p, t);
    o.frequency.exponentialRampToValueAtTime(48 * x.p, t + 0.12 * x.d);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42 * x.d);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + 0.45 * x.d);
  },
  snare(ac, t, out, nb, v, x = X0) {
    const n = noise(ac, nb), hp = ac.createBiquadFilter(), ng = ac.createGain();
    hp.type = 'highpass'; hp.frequency.value = 1400 * x.p;
    ng.gain.setValueAtTime(v * 0.9, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.2 * x.d);
    n.connect(hp).connect(ng).connect(out);
    n.start(t); n.stop(t + 0.22 * x.d);
    const o = ac.createOscillator(), og = ac.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(185 * x.p, t);
    og.gain.setValueAtTime(v * 0.55, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.12 * x.d);
    o.connect(og).connect(out);
    o.start(t); o.stop(t + 0.14 * x.d);
  },
  clap(ac, t, out, nb, v, x = X0) {
    const bp = ac.createBiquadFilter(), busg = ac.createGain();
    bp.type = 'bandpass'; bp.frequency.value = 1150 * x.p; bp.Q.value = 0.7;
    bp.connect(busg).connect(out);
    const bursts = [0, 0.012, 0.024, 0.04];
    bursts.forEach((d, i) => {
      const n = noise(ac, nb), ng = ac.createGain();
      const last = i === bursts.length - 1;
      ng.gain.setValueAtTime(0.0001, t + d);
      ng.gain.exponentialRampToValueAtTime(v * (last ? 0.8 : 0.55), t + d + 0.001);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + d + (last ? 0.18 : 0.02) * x.d);
      n.connect(ng).connect(bp);
      n.start(t + d); n.stop(t + d + 0.2 * x.d);
    });
  },
  hat(ac, t, out, nb, v, x = X0) { hatVoice(ac, t, out, nb, v, 0.045 * x.d, 7200 * x.p); },
  ohat(ac, t, out, nb, v, x = X0) { hatVoice(ac, t, out, nb, v, 0.34 * x.d, 6200 * x.p); },
  tom(ac, t, out, nb, v, x = X0) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(220 * x.p, t);
    o.frequency.exponentialRampToValueAtTime(98 * x.p, t + 0.22 * x.d);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3 * x.d);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + 0.33 * x.d);
  },
  rim(ac, t, out, nb, v, x = X0) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(1700 * x.p, t);
    g.gain.setValueAtTime(v * 0.7, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03 * x.d);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + 0.04 * x.d);
    const n = noise(ac, nb), hp = ac.createBiquadFilter(), ng = ac.createGain();
    hp.type = 'highpass'; hp.frequency.value = 3000 * x.p;
    ng.gain.setValueAtTime(v * 0.35, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.02 * x.d);
    n.connect(hp).connect(ng).connect(out);
    n.start(t); n.stop(t + 0.03 * x.d);
  },
  cowbell(ac, t, out, nb, v, x = X0) {
    const bp = ac.createBiquadFilter(), g = ac.createGain();
    bp.type = 'bandpass'; bp.frequency.value = 560 * x.p; bp.Q.value = 1.4;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v * 0.6, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26 * x.d);
    bp.connect(g).connect(out);
    for (const f of [540, 800]) {
      const o = ac.createOscillator();
      o.type = 'square'; o.frequency.setValueAtTime(f * x.p, t);
      o.connect(bp); o.start(t); o.stop(t + 0.28 * x.d);
    }
  },
};

function hatVoice(ac, t, out, nb, v, dur, hz) {
  const n = noise(ac, nb), hp = ac.createBiquadFilter(), g = ac.createGain();
  hp.type = 'highpass'; hp.frequency.value = hz;
  g.gain.setValueAtTime(v * 0.6, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  n.connect(hp).connect(g).connect(out);
  n.start(t); n.stop(t + dur + 0.02);
}

function noise(ac, buf) { const s = ac.createBufferSource(); s.buffer = buf; return s; }
function makeNoise(ac) {
  const len = Math.floor(ac.sampleRate * 1.5);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}
const xOf = (snap, id) => ({ p: Math.pow(2, snap.pitch[id] / 12), d: snap.decay[id] });

/* melody sounds: factory patches of the Static Synth that suit a tune line */
const MEL_PATCHES = ['pluck', 'soft-keys', 'saw-lead', 'sub-bass', 'space-bells', 'brass', 'warm-pad'];
const melPatch = id => (SYNTH_PRESETS.find(p => p.id === id) || SYNTH_PRESETS.find(p => p.id === 'pluck')).p;
const melName = id => (SYNTH_PRESETS.find(p => p.id === id) || { name: id }).name;
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = m => NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1);

/* --- song mode: pure helpers, shared by playback and export --- */
const SONG_MAX = 64;          /* entries in a song */
const TIMES_MAX = 16;         /* repeats of one entry */
const normPattern = M.normPattern;

/** Song entries + the pattern library → one bar per repeat, back to back. */
function songPlan(items, patterns) {
  const byId = new Map((patterns || []).map(p => [p.id, p]));
  const bars = [];
  let t = 0;
  (items || []).forEach((it, idx) => {
    const p = byId.get(it.pat);
    if (!p) return;                                /* deleted from the library: skipped */
    const snap = normPattern(p);
    const sd = M.stepDurOf(snap.bpm, snap.trip);
    for (let r = 0; r < it.times; r++) {
      bars.push({ idx, rep: r, of: it.times, start: t, dur: sd * snap.len, sd, len: snap.len, snap });
      t += sd * snap.len;
    }
  });
  return { bars, total: t };
}

/** The hits of one step of one bar: when (song time), which voice, how loud, how it is tuned. */
function stepHits(bar, step, only) {
  let t = bar.start + step * bar.sd;
  if (!bar.snap.trip && step % 2 === 1) t += bar.sd * bar.snap.swing;
  const out = [];
  for (const inst of INSTRUMENTS) {
    if (only && only !== inst.id) continue;
    const vol = bar.snap.vols[inst.id], l = bar.snap.steps[inst.id][step];
    if (!l || bar.snap.mutes[inst.id] || !(vol > 0.001)) continue;
    out.push({ t, id: inst.id, v: inst.peak * vol * LEVEL_GAIN[l], x: xOf(bar.snap, inst.id) });
  }
  return out;
}
/** Play the melody notes that start on a step, on a synth (live or offline), at song time `base`. */
function stepMelody(syn, bar, step, base) {
  const mel = bar.snap.mel;
  for (const n of mel.notes) {
    if (n.s !== step) continue;
    syn.setPatch(melPatch(mel.patch));
    syn.noteOn(n.n, 0.9 * Math.max(0.1, mel.vol), 'm', base);
    syn.noteOff(n.n, 'm', base + n.l * bar.sd * 0.95);
  }
}

const fmtLen = s => { const v = Math.max(0, Math.round(s)); return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`; };
const stampNow = () => new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '');

defineApp({
  id: 'beats',
  name: 'Static Beats',
  icon: 'grid',
  g1: '#ff9234', g2: '#d94407',
  category: 'Media',
  keywords: ['drum', 'machine', 'sequencer', 'beat', 'rhythm', '808', 'synth', 'loop', 'pattern', 'metronome', 'step', 'groove',
    'song', 'arrange', 'arrangement', 'wav', 'midi', 'stems', 'triplet', 'melody', 'piano roll', 'house', 'dub', 'bossa', 'jam'],
  desc: 'A step-sequencer drum machine — synthesised drums, no samples',
  singleton: true,
  win: { w: 780, h: 624, minW: 380, minH: 440 },
  /* keys listed on the shortcut sheet (hold ⌘ / Ctrl): each one is bound below */
  shortcuts: [
    ['Space', 'Play or stop'],
    ['Up / Down', 'Tempo up / down (with Shift, by 5)'],
    ['Z', 'Undo, with Ctrl or ⌘ held (Shift + Z, or Y, redoes)'],
  ],

  mount(ctx) {
    const { root, win, api } = ctx;
    const { h, icon, clear, store, notify, confirm, menu, vfs } = api;

    /* ------------------------------ state ------------------------------ */
    const S = {
      bpm: 120,
      swing: 0,                       /* 0..0.5, fraction of a 16th */
      len: 16, trip: false,           /* steps in the bar; triplets (3 to a beat) or straight (4) */
      steps: {},                      /* id -> level[len] (0 rest, 1 soft, 2 medium, 3 loud) */
      vols: {},                       /* id -> 0..1 */
      mutes: {},                      /* id -> bool */
      pitch: {}, decay: {},           /* id -> semitones / decay multiplier */
      locks: {},                      /* id -> bool: Random leaves it alone */
      mel: { patch: 'pluck', vol: 0.7, notes: [] },
      lane: 'drums',                  /* 'drums' | 'melody' */
      melBase: 48,                    /* lowest note on the roll */
      level: 2,                       /* the hit level the grid paints */
      density: 0.4,                   /* Random: share of steps filled */
      countIn: false, loopSong: false, tune: false,
      playing: false,
      view: 'pattern',                /* 'pattern' (the grid) | 'song' (the arrangement) */
      playMode: null,                 /* what is playing: 'pattern' | 'song' */
      sp: null,                       /* song playback: { plan, t0, bar, step, drawBar } */
      song: [],                       /* [{ id, pat, name, times }] */
      ac: null, master: null, comp: null, noiseBuf: null, rowGain: {}, songBus: null, melSyn: null, melBus: null,
      currentStep: 0, nextNoteTime: 0, drawStep: -1,
      timer: 0, rafId: 0, queue: [],
      tap: [],                        /* tap-tempo timestamps */
      paint: null,                    /* drag-paint target level */
      touched: new Set(),             /* rows changed by the current drag (sent to a friend when it ends) */
      hist: [], redo: [], clip: null, /* undo, redo, the copied row */
      room: null, roomOffs: [], peer: null, lim: limiter(40, 1000),
      dead: false, saveTimer: 0, unsub: [], noAudio: false,
    };
    const blankFor = () => { for (const inst of INSTRUMENTS) { S.steps[inst.id] = M.emptyRow(S.len); S.vols[inst.id] = 0.8; S.mutes[inst.id] = false; S.pitch[inst.id] = 0; S.decay[inst.id] = 1; S.locks[inst.id] = false; } };
    blankFor();
    const stepSec = () => M.stepDurOf(S.bpm, S.trip);
    const group = () => M.groupOf(S.trip);

    /* cell + header refs, indexed [id][step] and [step] */
    const cellOf = {};                /* id -> [buttonEl x len] */
    let colHead = [];                 /* [numEl x len] */

    /* ------------------------------ audio ------------------------------ */
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);

    function ensureAudio() {
      if (S.ac || S.noAudio) return S.ac;
      if (!AC) { S.noAudio = true; return null; }
      try {
        const ac = new AC();
        const comp = ac.createDynamicsCompressor();  /* honest peak control, not fake loudness */
        comp.threshold.value = -6; comp.knee.value = 8; comp.ratio.value = 4;
        comp.attack.value = 0.003; comp.release.value = 0.14;
        const master = ac.createGain();
        master.connect(comp).connect(ac.destination);
        S.ac = ac; S.comp = comp; S.master = master; S.noiseBuf = makeNoise(ac);
        for (const inst of INSTRUMENTS) {
          const g = ac.createGain();
          g.connect(master);
          S.rowGain[inst.id] = g;
        }
        /* a song's patterns bring their own levels: they arrive in each hit */
        S.songBus = ac.createGain();
        S.songBus.connect(master);
        applyMaster(); IDS.forEach(applyRowGain);
      } catch (err) { S.noAudio = true; S.ac = null; }
      return S.ac;
    }
    /* the melody's synth is built the first time a note has to sound */
    function melody() {
      const ac = ensureAudio();
      if (!ac) return null;
      if (!S.melSyn) {
        S.melBus = ac.createGain();
        S.melBus.connect(S.master);
        S.melSyn = createSynth(ac, { patch: melPatch(S.mel.patch), maxVoices: 12, destination: S.melBus });
      }
      return S.melSyn;
    }

    const sysVol = () => clamp((Number(store.get('prefs.volume', 62)) || 0) / 100, 0, 1);
    const sysMuted = () => store.get('prefs.muted', false) === true;

    function applyMaster() {
      if (!S.master || !S.ac) return;
      const target = sysMuted() ? 0.0001 : Math.max(0.0001, sysVol());
      try { S.master.gain.setTargetAtTime(target, S.ac.currentTime, 0.015); } catch (e) {}
    }
    function applyRowGain(id) {
      const g = S.rowGain[id];
      if (!g || !S.ac) return;
      const target = S.mutes[id] ? 0.0001 : Math.max(0.0001, S.vols[id]);
      try { g.gain.setTargetAtTime(target, S.ac.currentTime, 0.012); } catch (e) {}
    }

    function playHit(id, t, level) {
      const inst = INSTRUMENTS.find(i => i.id === id);
      VOICES[id](S.ac, t, S.rowGain[id], S.noiseBuf, inst.peak * LEVEL_GAIN[level], { p: Math.pow(2, S.pitch[id] / 12), d: S.decay[id] });
    }
    function beep(t, accent) {
      const ac = S.ac, o = ac.createOscillator(), g = ac.createGain();
      o.type = 'square'; o.frequency.value = accent ? 1600 : 1000;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.12, t + 0.001);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      o.connect(g).connect(S.master);
      o.start(t); o.stop(t + 0.06);
    }

    /* ---------------------------- scheduler ---------------------------- */
    function scheduleStep(step, t) {
      for (const inst of INSTRUMENTS) { const l = S.steps[inst.id][step]; if (l) playHit(inst.id, t, l); }
      if (S.mel.notes.length) {
        const syn = melody();
        if (syn) for (const n of S.mel.notes) {
          if (n.s !== step) continue;
          syn.noteOn(n.n, 0.9 * Math.max(0.1, S.mel.vol), 'm', t);
          syn.noteOff(n.n, 'm', t + n.l * stepSec() * 0.95);
        }
      }
    }
    function scheduler() {
      const ac = S.ac;
      if (!ac) return;
      while (S.nextNoteTime < ac.currentTime + AHEAD_S) {
        const step = S.currentStep;
        let when = S.nextNoteTime;
        if (!S.trip && step % 2 === 1) when += stepSec() * S.swing;   /* swing pushes the off-16ths late */
        scheduleStep(step, when);
        S.queue.push({ step, time: when, beat: step % group() === 0 });
        S.nextNoteTime += stepSec();
        S.currentStep = (S.currentStep + 1) % S.len;
      }
    }
    /* the song: step by step through its bars, each in its own pattern's
       tempo and swing; done once the last bar has rung out (or round again, when looping) */
    function songScheduler() {
      const ac = S.ac, sp = S.sp;
      if (!ac || !sp) return;
      const bars = sp.plan.bars;
      for (;;) {
        while (sp.bar < bars.length) {
          const bar = bars[sp.bar];
          const base = sp.t0 + bar.start + sp.step * bar.sd;
          if (base >= ac.currentTime + AHEAD_S) return;
          for (const hit of stepHits(bar, sp.step)) VOICES[hit.id](ac, sp.t0 + hit.t, S.songBus, S.noiseBuf, hit.v, hit.x);
          if (bar.snap.mel.notes.length) { const syn = melody(); if (syn) stepMelody(syn, bar, sp.step, base); }
          S.queue.push({ bar: sp.bar, step: sp.step, time: base, beat: sp.step % M.groupOf(bar.snap.trip) === 0 });
          sp.step++;
          if (sp.step >= bar.len) { sp.step = 0; sp.bar++; }
        }
        if (S.loopSong && ac.currentTime + AHEAD_S >= sp.t0 + sp.plan.total) { sp.t0 += sp.plan.total; sp.bar = 0; sp.step = 0; continue; }
        break;
      }
      if (!S.loopSong && sp.bar >= bars.length && ac.currentTime >= sp.t0 + sp.plan.total + 0.05) stop();
    }

    const pulse = h('span.beats__pulse', { 'aria-hidden': 'true' });
    function flash() {
      if (reduced()) return;
      pulse.classList.remove('is-hit'); void pulse.offsetWidth; pulse.classList.add('is-hit');
    }
    const reduced = () => !!store.get('prefs.reduceMotion') || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

    function draw() {
      if (!S.playing) { S.rafId = 0; return; }
      const ac = S.ac;
      if (S.playMode === 'song') {
        let at = null;
        while (S.queue.length && S.queue[0].time <= ac.currentTime) { at = S.queue.shift(); if (at.beat) flash(); }
        if (at) paintSongPos(at.bar, at.step);
        S.rafId = requestAnimationFrame(draw);
        return;
      }
      let step = S.drawStep;
      while (S.queue.length && S.queue[0].time <= ac.currentTime) {
        const q = S.queue.shift();
        if (q.beat) flash();
        if (q.count) { posEl.textContent = `Count-in ${q.count}`; continue; }
        step = q.step;
      }
      if (step !== S.drawStep) {
        S.drawStep = step;
        paintPlayhead(step);
        if (step >= 0) posEl.textContent = `Step ${step + 1} / ${S.len}`;
      }
      S.rafId = requestAnimationFrame(draw);
    }

    async function openAudio() {
      const ac = ensureAudio();
      if (!ac) { notify({ app: 'Static Beats', icon: 'alert', title: 'No audio here', message: 'This browser has no Web Audio, so Static Beats cannot make sound.' }); return null; }
      try { if (ac.state === 'suspended') await ac.resume(); } catch (e) {}
      return S.dead ? null : ac;
    }

    async function start() {
      const ac = await openAudio();
      if (!ac || S.playing) return;
      S.playing = true;
      S.playMode = 'pattern';
      S.currentStep = 0; S.drawStep = -1; S.queue = [];
      let t0 = ac.currentTime + 0.06;
      if (S.countIn) {                                    /* a bar of four clicks, one to a beat */
        const beat = 60 / S.bpm;
        for (let i = 0; i < 4; i++) { beep(t0 + i * beat, i === 0); S.queue.push({ count: i + 1, time: t0 + i * beat, beat: true }); }
        t0 += 4 * beat;
      }
      S.nextNoteTime = t0;
      scheduler();
      S.timer = setInterval(scheduler, LOOKAHEAD_MS);
      S.rafId = requestAnimationFrame(draw);
      paintTransport();
      if (S.countIn) posEl.textContent = 'Count-in 1';
    }

    async function startSong() {
      const plan = songPlan(S.song, savedPatterns());
      if (!plan.bars.length) {
        notify({ app: 'Static Beats', icon: 'list-music', title: 'The song is empty',
          message: S.song.length ? 'Its patterns were deleted from your library.' : 'Add a saved pattern to the song first.', timeout: 3200 });
        return;
      }
      const ac = await openAudio();
      if (!ac || S.playing) return;
      S.playing = true;
      S.playMode = 'song';
      S.queue = [];
      S.sp = { plan, t0: ac.currentTime + 0.08, bar: 0, step: 0, drawBar: -1 };
      songScheduler();
      S.timer = setInterval(songScheduler, LOOKAHEAD_MS);
      S.rafId = requestAnimationFrame(draw);
      paintTransport();
      paintSongPos(-1, 0);
    }

    function stop() {
      const wasSong = S.playMode === 'song';
      S.playing = false;
      S.playMode = null;
      if (S.timer) { clearInterval(S.timer); S.timer = 0; }
      if (S.rafId) { cancelAnimationFrame(S.rafId); S.rafId = 0; }
      S.queue = []; S.drawStep = -1;
      if (S.melSyn) { try { S.melSyn.allNotesOff(); } catch (e) {} }
      if (wasSong) { S.sp = null; paintSongPos(-1, 0); }
      clearPlayhead();
      paintTransport();
    }
    const togglePlay = () => (S.playing ? stop() : S.view === 'song' ? startSong() : start());

    /* ----------------------------- painting ---------------------------- */
    function paintPlayhead(step) {
      clearPlayhead();
      if (step < 0) return;
      colHead[step]?.classList.add('is-play');
      for (const id of IDS) cellOf[id][step]?.classList.add('is-play');
      rollHead[step]?.classList.add('is-play');
    }
    function clearPlayhead() {
      for (const el of colHead) el?.classList.remove('is-play');
      for (const id of IDS) for (const el of cellOf[id] || []) el?.classList.remove('is-play');
      for (const el of rollHead) el?.classList.remove('is-play');
    }

    function paintCell(id, step) {
      const c = cellOf[id][step];
      if (!c) return;
      const l = S.steps[id][step];
      c.classList.toggle('is-on', l > 0);
      c.dataset.level = String(l);
      c.setAttribute('aria-pressed', l > 0 ? 'true' : 'false');
      c.title = l ? `${LEVEL_NAMES[l]} hit` : '';
    }
    /* level 0 clears the step; `remote` is a friend's edit, which isn't echoed back */
    function setCell(id, step, level, remote = false) {
      if (step < 0 || step >= S.len || S.steps[id][step] === level) return;
      const row = S.steps[id].slice();
      row[step] = level;
      S.steps[id] = row;
      paintCell(id, step);
      if (!remote) { S.touched.add(id); sendRoom('c', { r: IDS.indexOf(id), s: step, l: level }); }
      queueSave();
    }
    function repaintCells() {
      for (const id of IDS) for (let s = 0; s < S.len; s++) paintCell(id, s);
    }

    /* --------------------------- persistence --------------------------- */
    function snapshot() {
      const steps = {};
      for (const id of IDS) steps[id] = S.steps[id].slice();
      return { bpm: S.bpm, swing: S.swing, len: S.len, trip: S.trip, steps, vols: { ...S.vols }, mutes: { ...S.mutes }, pitch: { ...S.pitch }, decay: { ...S.decay },
        mel: { patch: S.mel.patch, vol: S.mel.vol, notes: S.mel.notes.map(n => ({ ...n })) } };
    }
    function loadSnapshot(snap) {
      if (!snap) return;
      const g = normPattern(snap);
      S.bpm = g.bpm; S.swing = g.swing; S.len = g.len; S.trip = g.trip;
      for (const id of IDS) {
        S.steps[id] = g.steps[id];
        if (typeof snap.vols?.[id] === 'number') S.vols[id] = g.vols[id];
        if (typeof snap.mutes?.[id] === 'boolean') S.mutes[id] = snap.mutes[id];
        S.pitch[id] = g.pitch[id]; S.decay[id] = g.decay[id];
      }
      S.mel = g.mel;
    }
    function loadPreset(preset) {
      remember();
      const g = M.presetGrid(preset);
      S.bpm = g.bpm; S.swing = g.swing; S.len = 16; S.trip = false;
      for (const id of IDS) { S.steps[id] = g.steps[id]; S.pitch[id] = 0; S.decay[id] = 1; }
      afterLoad();
      sendShape(); IDS.forEach(sendRow);
    }
    function afterLoad() {
      rebuildGrid();
      for (const id of IDS) { applyRowGain(id); syncRowUI(id); }
      syncMelUI(); refreshRoll();
      paintTransport(); syncTempoUI(); syncSwingUI(); syncShapeUI(); syncUndo();
      queueSave();
    }

    const beatsData = () => {
      const d = store.get('portal.beats');
      return (d && typeof d === 'object' && !Array.isArray(d)) ? d : {};
    };
    /* every write keeps what it doesn't change (the song, the library) */
    const writeBeats = patch => store.set('portal.beats', { ...beatsData(), ...patch });
    function queueSave() {
      if (S.saveTimer) clearTimeout(S.saveTimer);
      S.saveTimer = setTimeout(() => {
        S.saveTimer = 0;
        const d = beatsData();
        writeBeats({ patterns: Array.isArray(d.patterns) ? d.patterns : [], last: snapshot() });
      }, 400);
    }
    function savedPatterns() { const d = beatsData(); return Array.isArray(d.patterns) ? d.patterns.filter(p => p && typeof p.id === 'string') : []; }
    function savePattern(name) {
      const list = savedPatterns();
      const entry = { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, name, at: Date.now(), ...snapshot() };
      writeBeats({ patterns: [entry, ...list].slice(0, 40), last: snapshot() });
      notify({ app: 'Static Beats', icon: 'save', title: 'Pattern saved', message: `“${name}” is in your library.`, timeout: 2600 });
      return entry;
    }
    function deletePattern(id) {
      const d = beatsData();
      writeBeats({ patterns: savedPatterns().filter(p => p.id !== id), last: d.last || snapshot() });
      paintSong();
    }

    /* ------------------------ undo, redo, row tools ------------------------ */
    const gridState = () => JSON.stringify({ len: S.len, trip: S.trip, steps: S.steps, pitch: S.pitch, decay: S.decay, mel: S.mel.notes });
    function remember() {
      const s = gridState();
      if (S.hist[S.hist.length - 1] === s) return;
      S.hist.push(s); if (S.hist.length > 100) S.hist.shift();
      S.redo = [];
      syncUndo();
    }
    function restore(str) {
      const o = JSON.parse(str);
      S.len = o.len; S.trip = o.trip;
      for (const id of IDS) { S.steps[id] = M.resize(o.steps[id] || [], o.len); S.pitch[id] = o.pitch[id] || 0; S.decay[id] = o.decay[id] || 1; }
      S.mel.notes = M.normMel({ notes: o.mel }).notes.filter(n => n.s < S.len);
      afterLoad();
      sendShape(); IDS.forEach(sendRow); IDS.forEach(sendRowSet);
    }
    function undo() { if (!S.hist.length) return; S.redo.push(gridState()); restore(S.hist.pop()); }
    function redo() { if (!S.redo.length) return; S.hist.push(gridState()); restore(S.redo.pop()); }

    function copyRow(id) { S.clip = { from: id, levels: S.steps[id].slice() }; syncRowUI(id); notify({ app: 'Static Beats', icon: 'copy', title: 'Row copied', message: `${nameOf(id)} is ready to paste into another row.`, timeout: 2200 }); }
    function pasteRow(id) {
      if (!S.clip) return;
      remember();
      S.steps[id] = M.resize(S.clip.levels, S.len);
      repaintCells(); queueSave(); sendRow(id);
    }
    function clearRow(id) { remember(); S.steps[id] = M.emptyRow(S.len); repaintCells(); queueSave(); sendRow(id); }
    function rotateRow(id, k) { remember(); S.steps[id] = M.rotate(S.steps[id], k); repaintCells(); queueSave(); sendRow(id); }
    function rotateAll(k) {
      remember();
      for (const id of IDS) S.steps[id] = M.rotate(S.steps[id], k);
      S.mel.notes = S.mel.notes.map(n => ({ ...n, s: ((n.s + k) % S.len + S.len) % S.len }));
      repaintCells(); paintRoll(); queueSave(); IDS.forEach(sendRow);
    }
    const nameOf = id => INSTRUMENTS.find(i => i.id === id).name;
    function toggleLock(id) { S.locks[id] = !S.locks[id]; syncRowUI(id); }

    /* ---- the song ---- */
    function readSong() {
      const raw = beatsData().song;
      const list = raw && Array.isArray(raw.items) ? raw.items : [];
      const seen = new Set();
      return list.filter(it => it && typeof it.pat === 'string' && typeof it.id === 'string' && !seen.has(it.id) && seen.add(it.id))
        .slice(0, SONG_MAX)
        .map(it => ({ id: it.id, pat: it.pat, name: String(it.name || 'Pattern').slice(0, 40), times: clamp(Math.round(Number(it.times) || 1), 1, TIMES_MAX) }));
    }
    function setSong(items) {
      S.song = items.slice(0, SONG_MAX);
      writeBeats({ song: { v: 1, loop: S.loopSong, items: S.song.map(it => ({ ...it })) } });
      if (S.playMode === 'song') stop();            /* an edit mid-song: the marker would point at the wrong place */
      paintSong();
    }
    const songUid = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    function songAdd(p) {
      if (S.song.length >= SONG_MAX) { notify({ app: 'Static Beats', icon: 'alert', title: 'That’s a long song', message: `A song holds up to ${SONG_MAX} parts.` }); return; }
      setSong([...S.song, { id: songUid(), pat: p.id, name: String(p.name || 'Pattern').slice(0, 40), times: 1 }]);
      focusSongRow(S.song.length - 1, 'more');
    }
    /* the grid as it is now goes into the library under a plain name, and onto the song, in one click */
    function songAddGrid() { const entry = savePattern(suggestName()); if (entry) songAdd(entry); }
    function songRemove(i) {
      const next = S.song.slice(); next.splice(i, 1);
      setSong(next);
      focusSongRow(Math.min(i, S.song.length - 1), 'remove');
    }
    function songMove(i, d) {
      const j = i + d;
      if (j < 0 || j >= S.song.length) return;
      const next = S.song.slice();
      [next[i], next[j]] = [next[j], next[i]];
      setSong(next);
      focusSongRow(j, d < 0 ? 'up' : 'down');
    }
    function songDup(i) {
      if (S.song.length >= SONG_MAX) return;
      const next = S.song.slice();
      next.splice(i + 1, 0, { ...S.song[i], id: songUid() });
      setSong(next);
      focusSongRow(i + 1, 'dup');
    }
    function songTimes(i, d) {
      const it = S.song[i];
      const n = clamp(it.times + d, 1, TIMES_MAX);
      if (n === it.times) return;
      const next = S.song.slice();
      next[i] = { ...it, times: n };
      setSong(next);
      focusSongRow(i, d < 0 ? 'fewer' : 'more');
    }
    function setLoopSong(on) {
      S.loopSong = on;
      writeBeats({ song: { v: 1, loop: on, items: S.song.map(it => ({ ...it })) } });
      loopBtn.setAttribute('aria-pressed', String(on)); loopBtn.classList.toggle('is-on', on);
    }

    /* ------------------------------ tempo ------------------------------ */
    function setBpm(v) { S.bpm = clamp(Math.round(v), 40, 240); syncTempoUI(); queueSave(); sendShape(); }
    function setSwing(v) { S.swing = clamp(v, 0, 0.5); syncSwingUI(); queueSave(); sendShape(); }
    function tapTempo() {
      const now = performance.now();
      S.tap = S.tap.filter(t => now - t < 2200);
      S.tap.push(now);
      if (S.tap.length >= 2) {
        const gaps = [];
        for (let i = 1; i < S.tap.length; i++) gaps.push(S.tap[i] - S.tap[i - 1]);
        const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
        if (avg > 0) setBpm(60000 / avg);
      }
    }
    /* length and triplets */
    function setShape(len, trip, remote = false) {
      len = clamp(Math.round(len), LEN_MIN, LEN_MAX);
      if (len === S.len && trip === S.trip) return;
      if (!remote) remember();
      S.len = len; S.trip = trip;
      for (const id of IDS) S.steps[id] = M.resize(S.steps[id], len);
      S.mel.notes = S.mel.notes.filter(n => n.s < len);
      if (S.playing && S.playMode === 'pattern') S.currentStep = S.currentStep % len;
      rebuildGrid(); refreshRoll(); syncShapeUI(); queueSave();
      if (!remote) sendShape();
    }
    const stepLen = d => setShape(S.len + d * group(), S.trip);
    function toggleTrip() {
      const trip = !S.trip;
      /* keep about the same time: 16 straight steps are 12 triplet steps */
      const len = trip ? Math.max(9, Math.round(S.len * 3 / 4 / 3) * 3) : Math.max(8, Math.round(S.len * 4 / 3 / 4) * 4);
      setShape(len, trip);
    }

    /* ------------------------------ export ----------------------------- */
    /* One path for every export: an OfflineAudioContext `seconds` long
       (to the sample), the same compressor as the live bus, `schedule`
       puts the hits in, and the result is a 16-bit WAV in ~/Music. */
    let exporting = false;
    async function render({ seconds, schedule, tailFadeMs = 0 }) {
      const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!Offline) throw new Error('This browser has no OfflineAudioContext to render a file.');
      const rate = 44100;
      const oac = new Offline(2, Math.max(1, Math.round(seconds * rate)), rate);
      const comp = oac.createDynamicsCompressor();
      comp.threshold.value = -6; comp.knee.value = 8; comp.ratio.value = 4;
      comp.attack.value = 0.003; comp.release.value = 0.14;
      const master = oac.createGain();
      master.gain.value = Math.max(0.15, sysMuted() ? 0.7 : sysVol());  /* export at an audible level */
      master.connect(comp).connect(oac.destination);
      const nb = makeNoise(oac);
      let syn = null;
      const melOf = () => syn || (syn = createSynth(oac, { patch: melPatch(S.mel.patch), destination: master, offline: true, maxVoices: 2048 }));
      schedule(oac, master, nb, melOf);
      const rendered = await oac.startRendering();
      if (syn) { try { syn.dispose(); } catch (e) {} }
      if (tailFadeMs > 0) {                       /* a song stops on its last sample: no click there */
        const n = Math.min(rendered.length, Math.round(rate * tailFadeMs / 1000));
        for (let c = 0; c < rendered.numberOfChannels; c++) {
          const d = rendered.getChannelData(c);
          for (let i = 0; i < n; i++) d[rendered.length - 1 - i] *= i / n;
        }
      }
      return rendered;
    }
    const wavBlob = rendered => new Blob([encodeWav(rendered)], { type: 'audio/wav' });
    async function bounce({ seconds, name, title, schedule, tailFadeMs = 0 }) {
      if (exporting) return null;
      exporting = true; syncTools(); paintSong();
      try {
        const rendered = await render({ seconds, schedule, tailFadeMs });
        const blob = wavBlob(rendered);
        const { path } = await media.save(`${vfs.HOME}/Music`, name, blob);
        if (S.dead) return { path, samples: rendered.length };
        notify({
          app: 'Static Beats', icon: 'music', title,
          message: `${name} (${(blob.size / 1024).toFixed(0)} KB, ${fmtLen(rendered.length / 44100)}) in ~/Music.`,
          actions: [{ label: 'Open in Music', onClick: () => api.openFile(path) }], timeout: 7000,
        });
        return { path, samples: rendered.length };
      } catch (err) {
        notify({ app: 'Static Beats', icon: 'alert', title: 'Export failed', message: String(err && err.message || err) });
        return null;
      } finally {
        exporting = false; if (!S.dead) { syncTools(); paintSong(); }
      }
    }
    /* the grid as a one-bar "song" so the loop, the stems and the song share one scheduler */
    function gridBars(loops) {
      const snap = normPattern(snapshot());
      const sd = M.stepDurOf(snap.bpm, snap.trip);
      return Array.from({ length: loops }, (_, k) => ({ idx: 0, rep: k, of: loops, start: k * sd * snap.len, dur: sd * snap.len, sd, len: snap.len, snap }));
    }
    function putBars(oac, master, nb, melOf, bars, only, at = 0) {
      for (const bar of bars) for (let step = 0; step < bar.len; step++) {
        for (const hit of stepHits(bar, step, only)) VOICES[hit.id](oac, at + hit.t, master, nb, hit.v, hit.x);
        if ((!only || only === 'melody') && bar.snap.mel.notes.length) stepMelody(melOf(), bar, step, at + bar.start + step * bar.sd);
      }
    }
    const loopSeconds = bars => bars.length * bars[0].dur + 0.6;

    /* the loop: twice round the grid, and a little tail for the last hit */
    function exportWav() {
      const bars = gridBars(2);
      return bounce({
        seconds: loopSeconds(bars),
        name: `Beat ${S.bpm}bpm ${stampNow()}.wav`,
        title: 'Loop saved to Music',
        schedule: (oac, master, nb, melOf) => putBars(oac, master, nb, melOf, bars, null, 0.02),
      });
    }
    /* stems: one WAV per row that has a hit (and the melody), each the whole loop, in a folder in ~/Music */
    async function exportStems() {
      if (exporting) return null;
      const bars = gridBars(2);
      const snap = bars[0].snap;
      const rows = IDS.filter(id => snap.steps[id].some(Boolean) && !snap.mutes[id]);
      if (snap.mel.notes.length) rows.push('melody');
      if (!rows.length) { notify({ app: 'Static Beats', icon: 'info', title: 'Nothing to export', message: 'Place a hit first.', timeout: 3000 }); return null; }
      exporting = true; syncTools(); paintSong();
      try {
        const dir = `${vfs.HOME}/Music/Beat stems ${S.bpm}bpm ${stampNow()}`;
        const files = [];
        for (const only of rows) {
          const rendered = await render({ seconds: loopSeconds(bars), schedule: (oac, master, nb, melOf) => putBars(oac, master, nb, melOf, bars, only, 0.02) });
          const { path } = await media.save(dir, `${only === 'melody' ? 'Melody' : nameOf(only)}.wav`, wavBlob(rendered));
          files.push(path);
        }
        if (!S.dead) notify({ app: 'Static Beats', icon: 'music', title: 'Stems saved to Music', message: `${files.length} files in ${vfs.baseName(dir)}, all the same length so they line up.`,
          actions: [{ label: 'Open in Music', onClick: () => api.openFile(files[0]) }], timeout: 7000 });
        return { dir, files };
      } catch (err) {
        notify({ app: 'Static Beats', icon: 'alert', title: 'Export failed', message: String(err && err.message || err) });
        return null;
      } finally { exporting = false; if (!S.dead) { syncTools(); paintSong(); } }
    }
    /* a Standard MIDI File: drums on channel 10 (General MIDI notes), the melody on its own track */
    async function exportMidi() {
      try {
        const snap = normPattern(snapshot());
        const bytes = writeSMF({ bpm: snap.bpm, ppq: 480, tracks: M.midiTracks(snap, 2, 480) });
        const name = `Beat ${S.bpm}bpm ${stampNow()}.mid`;
        const { path } = await media.save(`${vfs.HOME}/Music`, name, new Blob([bytes], { type: 'audio/midi' }));
        notify({ app: 'Static Beats', icon: 'music', title: 'MIDI saved to Music', message: `${name} (${bytes.length} bytes). Drums are on channel 10.`, timeout: 6000 });
        return { path, bytes: bytes.length };
      } catch (err) {
        notify({ app: 'Static Beats', icon: 'alert', title: 'Export failed', message: String(err && err.message || err) });
        return null;
      }
    }
    async function sendToSoundboard() {
      const r = await exportWav();
      if (r && r.path && !S.dead) api.openApp('soundboard', { addFile: r.path });
      return r;
    }

    /* the song: exactly as long as its bars, each pattern at its own tempo */
    function exportSong() {
      const plan = songPlan(S.song, savedPatterns());
      if (!plan.bars.length) {
        notify({ app: 'Static Beats', icon: 'list-music', title: 'Nothing to export', message: 'Add a saved pattern to the song first.', timeout: 3200 });
        return null;
      }
      return bounce({
        seconds: plan.total,
        name: `Song ${plan.bars.length} bars ${stampNow()}.wav`,
        title: 'Song saved to Music',
        tailFadeMs: 6,
        schedule: (oac, master, nb, melOf) => putBars(oac, master, nb, melOf, plan.bars, null, 0),
      });
    }

    /* 16-bit PCM stereo WAV from an AudioBuffer, little-endian. */
    function encodeWav(buf) {
      const chs = Math.min(2, buf.numberOfChannels);
      const n = buf.length, rate = buf.sampleRate;
      const data = new ArrayBuffer(44 + n * chs * 2);
      const v = new DataView(data);
      const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
      str(0, 'RIFF'); v.setUint32(4, 36 + n * chs * 2, true); str(8, 'WAVE');
      str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, chs, true);
      v.setUint32(24, rate, true); v.setUint32(28, rate * chs * 2, true); v.setUint16(32, chs * 2, true); v.setUint16(34, 16, true);
      str(36, 'data'); v.setUint32(40, n * chs * 2, true);
      const ch = [];
      for (let c = 0; c < chs; c++) ch.push(buf.getChannelData(c));
      let off = 44;
      for (let i = 0; i < n; i++) for (let c = 0; c < chs; c++) {
        const s = clamp(ch[c][i] || 0, -1, 1);
        v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true); off += 2;
      }
      return data;
    }

    /* ============================= UI ============================= */

    /* --- transport --- */
    const playBtn = h('button.btn.btn--primary.beats__play', { type: 'button', 'aria-label': 'Play', onclick: togglePlay });
    const bpmVal = h('span.beats__bpmnum', { 'aria-hidden': 'true' });
    const bpmRange = h('input.slider.beats__bpmrange', {
      type: 'range', min: '40', max: '240', step: '1', 'aria-label': 'Tempo in beats per minute',
      oninput: e => setBpm(+e.target.value),
    });
    const swVal = h('span.beats__swnum', { 'aria-hidden': 'true' });
    const swRange = h('input.slider.beats__swrange', {
      type: 'range', min: '0', max: '50', step: '1', 'aria-label': 'Swing amount, percent',
      oninput: e => setSwing((+e.target.value) / 100),
    });

    const tempoCtl = h('div.beats__ctl',
      h('div.beats__ctlhead',
        h('span.beats__ctllabel', icon('gauge'), h('span', { text: 'Tempo' })),
        h('div.beats__stepper',
          h('button.ibtn', { type: 'button', 'aria-label': 'Slower', onclick: () => setBpm(S.bpm - 1) }, icon('minus')),
          bpmVal,
          h('button.ibtn', { type: 'button', 'aria-label': 'Faster', onclick: () => setBpm(S.bpm + 1) }, icon('plus')),
          h('button.ibtn.tip', { type: 'button', 'data-tip': 'Tap tempo', 'aria-label': 'Tap tempo', onclick: tapTempo }, icon('clock')))),
      bpmRange);

    const swingCtl = h('div.beats__ctl',
      h('div.beats__ctlhead',
        h('span.beats__ctllabel', icon('zap'), h('span', { text: 'Swing' })),
        swVal),
      swRange);

    const posEl = h('span.beats__posnum', { 'aria-live': 'off' });
    const countBtn = h('button.beats__chip.tip', { type: 'button', 'aria-pressed': 'false', 'data-tip': 'A bar of clicks before it plays', onclick: () => { S.countIn = !S.countIn; writeBeats({ countIn: S.countIn }); syncChips(); } }, h('span', { text: 'Count-in' }));
    const bar = h('div.beats__bar',
      h('div.beats__transport', playBtn, h('div.beats__pos', h('div.beats__posrow', pulse, posEl), countBtn)),
      tempoCtl, swingCtl);

    /* --- tools bar --- */
    const presetBtn = h('button.btn.btn--sm', { type: 'button', onclick: e => openPresetMenu(e) }, icon('layers'), h('span', { text: 'Presets' }), icon('chevron-down'));
    const loadBtn = h('button.btn.btn--sm', { type: 'button', onclick: e => openLibraryMenu(e) }, icon('folder-open'), h('span', { text: 'Load' }), icon('chevron-down'));
    const saveBtn = h('button.btn.btn--sm', { type: 'button', onclick: () => openSaveSheet() }, icon('save'), h('span', { text: 'Save' }));
    const randBtn = h('button.btn.btn--sm.tip', { type: 'button', 'data-tip': 'Randomise pattern (locked rows stay)', 'aria-label': 'Randomise', onclick: () => randomise() }, icon('shuffle'), h('span', { text: 'Random' }));
    const densRange = h('input.slider.beats__dens', { type: 'range', min: '10', max: '90', step: '5', value: '40', 'aria-label': 'Random density, percent',
      oninput: e => { S.density = (+e.target.value) / 100; densVal.textContent = `${e.target.value}%`; } });
    const densVal = h('span.beats__densval', { text: '40%', 'aria-hidden': 'true' });
    const clearBtn = h('button.btn.btn--sm.tip', { type: 'button', 'data-tip': 'Clear all steps', 'aria-label': 'Clear', onclick: () => clearAll() }, icon('rotate-ccw'), h('span', { text: 'Clear' }));
    const undoBtn = h('button.ibtn.tip', { type: 'button', 'data-tip': 'Undo', 'aria-label': 'Undo', onclick: undo }, icon('undo'));
    const redoBtn = h('button.ibtn.tip', { type: 'button', 'data-tip': 'Redo', 'aria-label': 'Redo', onclick: redo }, icon('redo'));
    const rotLeft = h('button.ibtn.tip', { type: 'button', 'data-tip': 'Rotate the pattern one step earlier', 'aria-label': 'Rotate pattern left', onclick: () => rotateAll(-1) }, icon('arrow-left'));
    const rotRight = h('button.ibtn.tip', { type: 'button', 'data-tip': 'Rotate the pattern one step later', 'aria-label': 'Rotate pattern right', onclick: () => rotateAll(1) }, icon('arrow-right'));
    const exportMenuBtn = h('button.btn.btn--sm', { type: 'button', 'aria-haspopup': 'menu', onclick: e => openExportMenu(e) }, icon('download'), h('span', { text: 'Export' }), icon('chevron-down'));
    const jamBtn = h('button.btn.btn--sm', { type: 'button', onclick: () => openJamSheet() }, icon('users'), h('span', { text: 'Jam' }));
    /* Pattern | Song: what the window shows, and what Play plays */
    const segBtn = (v, ic, label) => h('button.beats__segbtn', { type: 'button', dataset: { view: v }, 'aria-pressed': 'false', onclick: () => setView(v) },
      icon(ic), h('span', { text: label }));
    const segs = [segBtn('pattern', 'grid', 'Pattern'), segBtn('song', 'list-music', 'Song')];
    /* Drums | Melody inside Pattern */
    const laneBtn = (v, label) => h('button.beats__segbtn', { type: 'button', dataset: { lane: v }, 'aria-pressed': 'false', onclick: () => setLane(v) }, h('span', { text: label }));
    const laneSegs = [laneBtn('drums', 'Drums'), laneBtn('melody', 'Melody')];
    /* the hit level the grid paints */
    const levelBtns = [1, 2, 3].map(l => h('button.beats__segbtn', { type: 'button', dataset: { level: String(l) }, 'aria-pressed': String(l === 2), 'aria-label': `Paint ${LEVEL_NAMES[l].toLowerCase()} hits`,
      onclick: () => { S.level = l; syncChips(); } }, h('span', { text: LEVEL_NAMES[l] })));
    /* steps and triplets */
    const lenNum = h('span.beats__lennum', { 'aria-live': 'polite' });
    const tripBtn = h('button.beats__chip', { type: 'button', 'aria-pressed': 'false', 'aria-label': 'Triplet grid', onclick: toggleTrip }, h('span', { text: 'Triplets' }));
    const lenCtl = h('div.beats__stepper.beats__lenctl',
      h('span.beats__ctllabel', h('span', { text: 'Steps' })),
      h('button.ibtn', { type: 'button', 'aria-label': 'Fewer steps', onclick: () => stepLen(-1) }, icon('minus')),
      lenNum,
      h('button.ibtn', { type: 'button', 'aria-label': 'More steps', onclick: () => stepLen(1) }, icon('plus')),
      tripBtn);
    const tuneBtn = h('button.beats__chip', { type: 'button', 'aria-pressed': 'false', onclick: () => { S.tune = !S.tune; syncChips(); } }, h('span', { text: 'Tune rows' }));
    const roomStat = h('span.beats__roomstat', { role: 'status', 'aria-live': 'polite' });
    const patTools = h('div.beats__ptools', presetBtn, loadBtn, saveBtn, undoBtn, redoBtn, randBtn, densRange, densVal, clearBtn, rotLeft, rotRight, exportMenuBtn, jamBtn, roomStat);
    const toolbar = h('div.beats__tools', h('div.beats__seg', { role: 'group', 'aria-label': 'Show' }, segs), patTools);
    const gridTools = h('div.beats__tools.beats__tools2',
      h('div.beats__seg', { role: 'group', 'aria-label': 'Lane' }, laneSegs),
      h('div.beats__seg.beats__levels', { role: 'group', 'aria-label': 'Hit level' }, levelBtns),
      lenCtl, tuneBtn);

    /* --- sequencer grid --- */
    const headSteps = h('div.beats__headsteps');
    const seqHead = h('div.beats__seqhead', h('div.beats__headspace', h('span', { text: 'Track' })), headSteps);

    const rowsWrap = h('div.beats__rows');
    const rowEls = {};
    for (const inst of INSTRUMENTS) {
      cellOf[inst.id] = [];
      const muteBtn = h('button.beats__mute', {
        type: 'button', 'aria-label': `Mute ${inst.name}`, 'aria-pressed': 'false',
        onclick: () => { S.mutes[inst.id] = !S.mutes[inst.id]; applyRowGain(inst.id); syncRowUI(inst.id); queueSave(); sendRowSet(inst.id); },
      }, icon('volume'), h('span.beats__mutename', { text: inst.name }));
      const moreBtn = h('button.ibtn.beats__more', { type: 'button', 'aria-label': `${inst.name} row menu`, 'aria-haspopup': 'menu', onclick: e => openRowMenu(inst.id, e) }, icon('more-horizontal'));
      const volRange = h('input.slider.beats__vol', {
        type: 'range', min: '0', max: '100', step: '1', 'aria-label': `${inst.name} volume`,
        oninput: e => { S.vols[inst.id] = clamp((+e.target.value) / 100, 0, 1); if (S.mutes[inst.id]) { S.mutes[inst.id] = false; syncRowUI(inst.id); } applyRowGain(inst.id); queueSave(); sendRowSet(inst.id); },
      });
      const pitchRange = h('input.slider.beats__pitch', { type: 'range', min: '-12', max: '12', step: '1', 'aria-label': `${inst.name} pitch, semitones`,
        onpointerdown: remember, onkeydown: remember,
        oninput: e => { S.pitch[inst.id] = +e.target.value; pitchOut.textContent = `${S.pitch[inst.id] > 0 ? '+' : ''}${S.pitch[inst.id]} st`; queueSave(); sendRowSet(inst.id); } });
      const decayRange = h('input.slider.beats__decay', { type: 'range', min: '30', max: '300', step: '5', 'aria-label': `${inst.name} decay, percent of normal`,
        onpointerdown: remember, onkeydown: remember,
        oninput: e => { S.decay[inst.id] = (+e.target.value) / 100; decayOut.textContent = `${e.target.value}%`; queueSave(); sendRowSet(inst.id); } });
      const pitchOut = h('span.beats__tval'), decayOut = h('span.beats__tval');
      const tuneBox = h('div.beats__tune', h('label', h('span', { text: 'Pitch' }), pitchRange, pitchOut), h('label', h('span', { text: 'Decay' }), decayRange, decayOut));
      const rowHead = h('div.beats__rowhead', h('div.beats__rowtop', muteBtn, moreBtn), volRange, tuneBox);
      rowHead._mute = muteBtn; rowHead._vol = volRange; rowHead._pitch = pitchRange; rowHead._decay = decayRange; rowHead._pout = pitchOut; rowHead._dout = decayOut; rowHead._more = moreBtn;

      const cells = h('div.beats__cells', { dataset: { inst: inst.id } });
      const row = h('div.beats__row', rowHead, cells);
      row._head = rowHead; row._cells = cells;
      rowEls[inst.id] = row;
      rowsWrap.appendChild(row);
    }

    /* (re)build the step numbers and every row's cells for the current length */
    function rebuildGrid() {
      const g = group();
      rowsWrap.style.setProperty('--len', String(S.len));
      headSteps.style.setProperty('--len', String(S.len));
      colHead = [];
      clear(headSteps);
      for (let s = 0; s < S.len; s++) {
        const num = h('div.beats__num' + (s % g === 0 ? '.is-down' : ''), { text: String(s + 1) });
        if (s % g === 0 && s > 0) num.classList.add('is-group');
        colHead[s] = num;
        headSteps.appendChild(num);
      }
      for (const inst of INSTRUMENTS) {
        const cells = rowEls[inst.id]._cells;
        cells.style.setProperty('--len', String(S.len));
        clear(cells);
        cellOf[inst.id] = [];
        for (let s = 0; s < S.len; s++) {
          const cell = h('button.beats__cell' + (s % g === 0 && s > 0 ? '.is-group' : '') + (s % g === 0 ? '.is-beat' : ''), {
            type: 'button', 'aria-pressed': 'false',
            'aria-label': `${inst.name} step ${s + 1}`,
            dataset: { step: String(s), inst: inst.id, level: '0' },
          });
          cellOf[inst.id][s] = cell;
          cells.appendChild(cell);
        }
      }
      repaintCells();
    }

    /* drag-to-paint across a row: pointerdown sets the target level,
       pointer moving over more cells applies it. Works for touch + mouse. */
    function cellFromPoint(x, y) {
      const el = document.elementFromPoint(x, y);
      const cell = el && el.closest && el.closest('.beats__cell');
      if (!cell || !rowsWrap.contains(cell)) return null;
      return cell;
    }
    const onCellDown = e => {
      const cell = e.target.closest && e.target.closest('.beats__cell');
      if (!cell) return;
      e.preventDefault();
      const id = cell.dataset.inst, step = +cell.dataset.step;
      remember();
      S.paint = S.steps[id][step] === S.level ? 0 : S.level;   /* the same level again takes it off */
      setCell(id, step, S.paint);
      try { rowsWrap.setPointerCapture(e.pointerId); } catch (err) {}
    };
    const onCellMove = e => {
      if (S.paint === null) return;
      const cell = cellFromPoint(e.clientX, e.clientY);
      if (!cell) return;
      setCell(cell.dataset.inst, +cell.dataset.step, S.paint);
    };
    const onCellUp = () => {
      if (S.paint === null) return;
      S.paint = null;
      for (const id of S.touched) sendRow(id);                 /* whatever the pace limit dropped mid-drag arrives now */
      S.touched.clear();
    };
    rowsWrap.addEventListener('pointerdown', onCellDown);
    rowsWrap.addEventListener('pointermove', onCellMove);
    window.addEventListener('pointerup', onCellUp);
    /* keyboard: a cell is a real button, so Enter/Space toggles it */
    rowsWrap.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const cell = e.target.closest && e.target.closest('.beats__cell');
      if (!cell) return;
      e.preventDefault();
      const id = cell.dataset.inst, step = +cell.dataset.step;
      remember();
      setCell(id, step, S.steps[id][step] === S.level ? 0 : S.level);
    });

    const seq = h('div.beats__seq', seqHead, rowsWrap);

    /* --- the melody: a piano roll --- */
    let rollHead = [];
    const melPatchSel = h('select.select.beats__melsel', { 'aria-label': 'Melody sound', onchange: e => { S.mel.patch = e.target.value; if (S.melSyn) S.melSyn.setPatch(melPatch(S.mel.patch)); queueSave(); } },
      MEL_PATCHES.map(id => h('option', { value: id, text: melName(id) })));
    const melVol = h('input.slider.beats__melvol', { type: 'range', min: '0', max: '100', step: '1', 'aria-label': 'Melody volume',
      oninput: e => { S.mel.vol = (+e.target.value) / 100; queueSave(); } });
    const melOct = h('span.beats__melrange.mono');
    const melClear = h('button.btn.btn--sm', { type: 'button', 'aria-label': 'Clear melody', onclick: () => { if (!S.mel.notes.length) return; remember(); S.mel.notes = []; paintRoll(); queueSave(); } }, icon('trash'), h('span', { text: 'Clear melody' }));
    const rollBody = h('div.beats__roll');
    const melPanel = h('div.beats__mel.hidden',
      h('div.beats__melbar',
        h('label.beats__ctllabel', h('span', { text: 'Sound' }), melPatchSel),
        h('label.beats__ctllabel', h('span', { text: 'Level' }), melVol),
        h('div.beats__stepper',
          h('button.ibtn', { type: 'button', 'aria-label': 'Roll octave down', onclick: () => shiftMel(-12) }, icon('chevron-down')), melOct,
          h('button.ibtn', { type: 'button', 'aria-label': 'Roll octave up', onclick: () => shiftMel(12) }, icon('chevron-up'))),
        melClear),
      h('p.beats__melhint', { text: 'Click a square to place a note; drag along the row to hold it longer. Click a note to take it off.' }),
      h('div.beats__rollwrap', rollBody));
    const MEL_ROWS = 24;
    function shiftMel(d) { S.melBase = clamp(S.melBase + d, M.MEL_LO, M.MEL_HI - MEL_ROWS + 1); buildRoll(); }
    function buildRoll() {
      clear(rollBody);
      rollBody.style.setProperty('--len', String(S.len));
      const g = group();
      rollHead = [];
      const head = h('div.beats__rollrow.beats__rollheadrow', h('span.beats__rolllab'), h('div.beats__rollcells'));
      for (let s = 0; s < S.len; s++) { const n = h('div.beats__num' + (s % g === 0 ? '.is-down' : ''), { text: String(s + 1) }); rollHead[s] = n; head.lastChild.appendChild(n); }
      rollBody.appendChild(head);
      for (let n = S.melBase + MEL_ROWS - 1; n >= S.melBase; n--) {
        const black = NOTE_NAMES[n % 12].includes('#');
        const cells = h('div.beats__rollcells');
        for (let s = 0; s < S.len; s++) cells.appendChild(h('button.beats__rcell' + (s % g === 0 ? '.is-beat' : ''), { type: 'button', tabindex: '-1', 'aria-label': `${noteName(n)} step ${s + 1}`, dataset: { n: String(n), s: String(s) } }));
        rollBody.appendChild(h('div.beats__rollrow' + (black ? '.is-black' : ''), { dataset: { n: String(n) } }, h('span.beats__rolllab', { text: n % 12 === 0 || !black ? noteName(n) : '' }), cells));
      }
      melOct.textContent = `${noteName(S.melBase)}–${noteName(S.melBase + MEL_ROWS - 1)}`;
      paintRoll();
    }
    function refreshRoll() { if (rollBody.childNodes.length) buildRoll(); }
    function paintRoll() {
      if (!rollBody.childNodes.length) return;
      for (const c of rollBody.querySelectorAll('.beats__rcell')) { c.classList.remove('is-note', 'is-start'); c.removeAttribute('data-len'); c.setAttribute('aria-pressed', 'false'); }
      for (const n of S.mel.notes) {
        for (let s = n.s; s < Math.min(S.len, n.s + n.l); s++) {
          const c = rollBody.querySelector(`.beats__rcell[data-n="${n.n}"][data-s="${s}"]`);
          if (!c) continue;
          c.classList.add('is-note'); c.setAttribute('aria-pressed', 'true');
          if (s === n.s) { c.classList.add('is-start'); c.dataset.len = String(n.l); }
        }
      }
    }
    let melDrag = null;
    function preview(n) {
      const syn = melody();
      if (!syn) return;
      ensureAudio()?.resume?.().catch(() => {});
      syn.noteOn(n, 0.8, 'pv');
      setTimeout(() => { try { syn.noteOff(n, 'pv'); } catch (e) {} }, 220);
    }
    rollBody.addEventListener('pointerdown', e => {
      const c = e.target.closest && e.target.closest('.beats__rcell');
      if (!c) return;
      e.preventDefault();
      const n = +c.dataset.n, s = +c.dataset.s;
      remember();
      const hit = S.mel.notes.findIndex(x => x.n === n && s >= x.s && s < x.s + x.l);
      if (hit >= 0) { S.mel.notes.splice(hit, 1); paintRoll(); queueSave(); return; }
      const note = { s, n, l: 1 };
      S.mel.notes.push(note);
      melDrag = { note, s0: s };
      paintRoll(); queueSave(); preview(n);
    });
    rollBody.addEventListener('pointermove', e => {
      if (!melDrag) return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const c = el && el.closest && el.closest('.beats__rcell');
      if (!c || +c.dataset.n !== melDrag.note.n) return;
      const l = clamp(+c.dataset.s - melDrag.s0 + 1, 1, S.len - melDrag.s0);
      if (l !== melDrag.note.l) { melDrag.note.l = l; paintRoll(); queueSave(); }
    });
    const onRollUp = () => { melDrag = null; };
    window.addEventListener('pointerup', onRollUp);
    rollBody.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const c = e.target.closest && e.target.closest('.beats__rcell');
      if (!c) return;
      e.preventDefault();
      const n = +c.dataset.n, s = +c.dataset.s;
      remember();
      const hit = S.mel.notes.findIndex(x => x.n === n && s >= x.s && s < x.s + x.l);
      if (hit >= 0) S.mel.notes.splice(hit, 1); else S.mel.notes.push({ s, n, l: 1 });
      paintRoll(); queueSave();
    });
    function syncMelUI() { melPatchSel.value = MEL_PATCHES.includes(S.mel.patch) ? S.mel.patch : 'pluck'; melVol.value = String(Math.round(S.mel.vol * 100)); }

    /* --- song mode: the arrangement --- */
    const songSum = h('div.beats__songsum');
    const addBtn = h('button.btn.btn--sm.btn--primary', { type: 'button', 'aria-haspopup': 'menu', onclick: e => openAddMenu(e) },
      icon('plus'), h('span', { text: 'Add pattern' }), icon('chevron-down'));
    const addGridBtn = h('button.btn.btn--sm', { type: 'button', onclick: () => songAddGrid() }, icon('plus'), h('span', { text: 'Add the grid' }));
    const loopBtn = h('button.btn.btn--sm', { type: 'button', 'aria-pressed': 'false', onclick: () => setLoopSong(!S.loopSong) }, icon('repeat'), h('span', { text: 'Loop song' }));
    const songExportBtn = h('button.btn.btn--sm', { type: 'button', onclick: () => exportSong() });
    const songClearBtn = h('button.btn.btn--sm.btn--ghost', { type: 'button', onclick: () => clearSong() }, icon('trash'), h('span', { text: 'Clear song' }));
    const songProgFill = h('i');
    const songProg = h('div.beats__songprog', { role: 'progressbar', 'aria-label': 'Position in the song', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, songProgFill);
    const songList = h('ol.beats__songlist', { 'aria-label': 'Song, in playing order' });
    const songEmpty = h('div.beats__songempty',
      icon('list-music'),
      h('b', { text: 'Chain your patterns into a song' }),
      h('small', { text: 'A song plays saved patterns in order, each as many times as you like, at its own tempo. Save a pattern from the grid, or press Add the grid, then add it here.' }));
    const songPanel = h('div.beats__song.hidden',
      h('div.beats__songhead', songSum, h('div.grow'), addBtn, addGridBtn, loopBtn, songExportBtn, songClearBtn),
      songProg, songList, songEmpty);
    /* Alt+↑ / Alt+↓ on a part moves it */
    songList.addEventListener('keydown', e => {
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      const row = e.target.closest && e.target.closest('.beats__songrow');
      if (!row) return;
      e.preventDefault();
      songMove(Number(row.dataset.i), e.key === 'ArrowUp' ? -1 : 1);
    });

    /* an instrument: Settings › Sound's click sounds stay out of it */
    const beatsEl = h('div.beats', bar, toolbar, gridTools, seq, melPanel, songPanel);
    root.appendChild(h('div.app.app--col', { 'data-sfx': 'off' }, beatsEl));

    function setView(v) {
      if (v !== 'pattern' && v !== 'song') return;
      S.view = v;
      const song = v === 'song';
      seq.classList.toggle('hidden', song || S.lane !== 'drums');
      melPanel.classList.toggle('hidden', song || S.lane !== 'melody');
      songPanel.classList.toggle('hidden', !song);
      patTools.classList.toggle('hidden', song);
      gridTools.classList.toggle('hidden', song);
      tempoCtl.classList.toggle('hidden', song);
      swingCtl.classList.toggle('hidden', song);
      for (const b of segs) {
        const on = b.dataset.view === v;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', String(on));
      }
      if (beatsData().view !== v) writeBeats({ view: v });
      paintTransport();
      paintSong();
    }
    function setLane(l) {
      S.lane = l === 'melody' ? 'melody' : 'drums';
      if (S.lane === 'melody' && !rollBody.childNodes.length) buildRoll();
      setView(S.view);
      for (const b of laneSegs) { const on = b.dataset.lane === S.lane; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); }
    }

    const sib = (ic, label, fn, disabled, role) => h('button.ibtn.beats__sib', {
      type: 'button', 'aria-label': label, title: label, disabled: !!disabled, dataset: { role }, onclick: fn,
    }, icon(ic));

    function paintSong() {
      const lib = savedPatterns();
      const pats = new Map(lib.map(p => [p.id, p]));
      const plan = songPlan(S.song, lib);
      const nb = plan.bars.length;
      songSum.textContent = nb ? `${S.song.length} part${S.song.length === 1 ? '' : 's'} · ${nb} bar${nb === 1 ? '' : 's'} · ${fmtLen(plan.total)}` : 'No bars yet';
      clear(songList);
      S.song.forEach((it, i) => {
        const p = pats.get(it.pat);
        const snap = p ? normPattern(p) : null;
        const barLen = snap ? M.stepDurOf(snap.bpm, snap.trip) * snap.len : 0;
        songList.appendChild(h('li.beats__songrow', { class: p ? null : 'is-missing', dataset: { i: String(i), id: it.id } },
          h('span.beats__songnum', { text: String(i + 1), 'aria-hidden': 'true' }),
          h('span.beats__songname',
            h('b', { text: it.name }),
            h('small', { text: p ? `${snap.bpm} BPM · ${barLen.toFixed(2)} s a bar` : 'Deleted from your library — skipped' })),
          h('span.beats__songtimes',
            sib('minus', `Fewer repeats of ${it.name}`, () => songTimes(i, -1), it.times <= 1, 'fewer'),
            h('span.beats__songx', { text: `×${it.times}`, title: `Plays ${it.times} time${it.times === 1 ? '' : 's'}` }),
            sib('plus', `More repeats of ${it.name}`, () => songTimes(i, 1), it.times >= TIMES_MAX, 'more')),
          h('span.beats__songnow'),
          h('span.beats__songacts',
            sib('arrow-up', `Move ${it.name} earlier`, () => songMove(i, -1), i === 0, 'up'),
            sib('arrow-down', `Move ${it.name} later`, () => songMove(i, 1), i === S.song.length - 1, 'down'),
            sib('copy', `Duplicate ${it.name}`, () => songDup(i), S.song.length >= SONG_MAX, 'dup'),
            sib('trash', `Remove ${it.name} from the song`, () => songRemove(i), false, 'remove'))));
      });
      songEmpty.classList.toggle('hidden', S.song.length > 0);
      songList.classList.toggle('hidden', !S.song.length);
      clear(songExportBtn);
      songExportBtn.append(exporting ? h('span.spinner') : icon('download'), h('span', { text: 'Export song' }));
      songExportBtn.disabled = exporting || !nb;
      songExportBtn.setAttribute('aria-busy', exporting ? 'true' : 'false');
      songExportBtn.title = nb ? `Save the whole song (${fmtLen(plan.total)}) to Music as a WAV file` : 'Add a pattern first';
      songClearBtn.disabled = !S.song.length;
      loopBtn.setAttribute('aria-pressed', String(S.loopSong)); loopBtn.classList.toggle('is-on', S.loopSong);
      if (S.playMode === 'song' && S.sp) { S.sp.drawBar = -1; } else paintSongPos(-1, 0);
    }

    /* the marker: which part is sounding (and which repeat), and how far into the song */
    function paintSongPos(barIx, step) {
      const sp = S.sp;
      const bar = sp && barIx >= 0 ? sp.plan.bars[barIx] : null;
      for (const row of songList.children) {
        const on = !!bar && Number(row.dataset.i) === bar.idx;
        row.classList.toggle('is-now', on);
        if (on) row.setAttribute('aria-current', 'step'); else row.removeAttribute('aria-current');
        const now = row.querySelector('.beats__songnow');
        if (now) now.textContent = on ? `${bar.rep + 1} of ${bar.of}` : '';
      }
      const pct = bar ? Math.min(100, ((bar.start + (step + 1) * bar.sd) / sp.plan.total) * 100) : 0;
      songProgFill.style.width = `${pct}%`;
      songProg.setAttribute('aria-valuenow', String(Math.round(pct)));
      if (bar) {
        posEl.textContent = `Bar ${barIx + 1} / ${sp.plan.bars.length}`;
        if (sp.drawBar !== barIx) {
          sp.drawBar = barIx;
          songList.querySelector(`.beats__songrow[data-i="${bar.idx}"]`)?.scrollIntoView({ block: 'nearest' });
        }
      }
    }

    /* after an edit the list is rebuilt: keep the keyboard on the same control */
    function focusSongRow(i, role) {
      if (i < 0) { addBtn.focus(); return; }
      const row = songList.querySelector(`.beats__songrow[data-i="${i}"]`);
      const b = row && (row.querySelector(`[data-role="${role}"]:not(:disabled)`) || row.querySelector('button:not(:disabled)'));
      (b || addBtn).focus();
    }

    function openAddMenu(e) {
      const r = e.currentTarget.getBoundingClientRect();
      const items = savedPatterns().map(p => ({ label: p.name, icon: 'list-music', hint: `${normPattern(p).bpm} BPM`, onClick: () => songAdd(p) }));
      if (items.length) items.push('-');
      items.push({ label: 'The grid as it is now…', icon: 'save', onClick: () => openSaveSheet({ add: true }) });
      menu(items, r.left, r.bottom + 4, { label: 'Add to the song' });
    }

    async function clearSong() {
      if (!S.song.length) return;
      const ok = await confirm({ title: 'Clear the song?', message: 'Every part comes off the song. Your saved patterns stay in the library.', ok: 'Clear song', danger: true });
      if (ok) setSong([]);
    }

    /* --- window tools: output state + export --- */
    const exportBtn = h('button.ibtn.tip', { type: 'button', 'data-tip': 'Export loop to Music (WAV)', 'aria-label': 'Export loop as WAV', onclick: () => exportWav() }, icon('download'));
    const volTool = h('button.ibtn.tip', { type: 'button', 'data-tip': 'Output', 'aria-label': 'Open sound settings', onclick: () => api.openApp('settings', { section: 'sound' }) });
    function syncTools() {
      clear(exportBtn);
      exportBtn.appendChild(exporting ? h('span.spinner') : icon('download'));
      exportBtn.setAttribute('aria-busy', exporting ? 'true' : 'false');
      clear(volTool);
      const muted = sysMuted();
      volTool.appendChild(icon(muted ? 'volume-x' : 'volume'));
      volTool.setAttribute('data-tip', muted ? 'System muted' : `Output ${Math.round(sysVol() * 100)}%`);
      volTool.classList.toggle('is-warn', muted);
    }
    win.setTools(volTool, exportBtn);

    /* ----------------------------- menus ------------------------------- */
    function openPresetMenu(e) {
      const r = e.currentTarget.getBoundingClientRect();
      const items = [];
      M.PRESETS.forEach((p, i) => {
        if (p.genre && !M.PRESETS[i - 1].genre) items.push('-');
        items.push({ label: p.name, icon: 'music', hint: `${p.bpm} BPM`, onClick: () => loadPreset(p) });
      });
      menu(items, r.left, r.bottom + 4);
    }
    function openLibraryMenu(e) {
      const r = e.currentTarget.getBoundingClientRect();
      const list = savedPatterns();
      if (!list.length) { menu([{ label: 'No saved patterns yet', disabled: true }], r.left, r.bottom + 4); return; }
      const items = [];
      for (const p of list) {
        items.push({ label: p.name, icon: 'list-music', hint: `${p.bpm} BPM`, onClick: () => { remember(); loadSnapshot(p); afterLoad(); sendShape(); IDS.forEach(sendRow); } });
      }
      items.push('-');
      /* the click is long over when this row is chosen: hand on where the button was */
      items.push({ label: 'Delete a pattern…', icon: 'trash', danger: true, onClick: () => openDeleteMenu(r) });
      menu(items, r.left, r.bottom + 4);
    }
    function openDeleteMenu(r) {
      const items = savedPatterns().map(p => ({
        label: p.name, icon: 'trash', danger: true,
        onClick: async () => {
          const uses = S.song.filter(it => it.pat === p.id).length;
          const ok = await confirm({ title: 'Delete pattern?', ok: 'Delete', danger: true,
            message: `“${p.name}” will be removed from your library.${uses ? ` It is in your song ${uses === 1 ? 'once' : `${uses} times`}; those parts will be skipped.` : ''}` });
          if (ok) deletePattern(p.id);
        },
      }));
      menu(items.length ? items : [{ label: 'Nothing saved', disabled: true }], r.left, r.bottom + 4);
    }
    function openExportMenu(e) {
      const r = e.currentTarget.getBoundingClientRect();
      menu([
        { label: 'Loop as WAV', icon: 'download', onClick: () => exportWav() },
        { label: 'Stems (one WAV per row)', icon: 'layers', onClick: () => exportStems() },
        { label: 'MIDI file', icon: 'music', onClick: () => exportMidi() },
        '-',
        { label: 'Send to Soundboard', icon: 'send', onClick: () => sendToSoundboard() },
      ], r.left, r.bottom + 4, { label: 'Export' });
    }
    function openRowMenu(id, e) {
      const r = e.currentTarget.getBoundingClientRect();
      menu([
        { label: 'Copy row', icon: 'copy', onClick: () => copyRow(id) },
        { label: S.clip ? `Paste ${nameOf(S.clip.from)} here` : 'Paste row', icon: 'clipboard', disabled: !S.clip, onClick: () => pasteRow(id) },
        { label: 'Clear row', icon: 'trash', onClick: () => clearRow(id) },
        '-',
        { label: 'Rotate row left', icon: 'arrow-left', onClick: () => rotateRow(id, -1) },
        { label: 'Rotate row right', icon: 'arrow-right', onClick: () => rotateRow(id, 1) },
        '-',
        { label: S.locks[id] ? 'Unlock for Random' : 'Lock for Random', icon: S.locks[id] ? 'unlock' : 'lock', onClick: () => toggleLock(id) },
      ], r.left, r.bottom + 4, { label: `${nameOf(id)} row` });
    }

    /* --- save sheet: a small inline name prompt (confirm() is yes/no) --- */
    let sheet = null;
    function openSaveSheet(opts = {}) {
      if (sheet) return;
      const input = h('input.beats__sheetin', { type: 'text', placeholder: 'Pattern name', 'aria-label': 'Pattern name', maxlength: '40', value: suggestName() });
      /* from the song's Add menu: saved, then added to the end of the song */
      const doSave = () => { const name = input.value.trim() || suggestName(); const entry = savePattern(name); closeSheet(); if (opts.add && entry) songAdd(entry); };
      const card = h('div.beats__sheet', { role: 'dialog', 'aria-label': opts.add ? 'Save the grid and add it to the song' : 'Save pattern' },
        h('div.beats__sheettitle', { text: opts.add ? 'Save the grid, then add it to the song' : 'Save pattern' }),
        input,
        h('div.beats__sheetrow',
          h('button.btn.btn--sm', { type: 'button', onclick: closeSheet }, h('span', { text: 'Cancel' })),
          h('button.btn.btn--sm.btn--primary', { type: 'button', onclick: doSave }, h('span', { text: 'Save' }))));
      input.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); doSave(); } else if (ev.key === 'Escape') { ev.preventDefault(); closeSheet(); } });
      sheet = h('div.beats__scrim', { onpointerdown: ev => { if (ev.target === sheet) closeSheet(); } }, card);
      beatsEl.appendChild(sheet);
      setTimeout(() => { input.focus(); input.select(); }, 30);
    }
    function closeSheet() { if (sheet) { sheet.remove(); sheet = null; } }
    function suggestName() {
      const active = INSTRUMENTS.filter(i => S.steps[i.id].some(Boolean)).map(i => i.name);
      return `${active[0] || 'Empty'} ${S.bpm}bpm`;
    }

    /* --------------------------- destructive --------------------------- */
    function clearAll() {
      remember();
      for (const id of IDS) S.steps[id] = M.emptyRow(S.len);
      repaintCells(); queueSave(); IDS.forEach(sendRow);
    }
    function randomise() {
      remember();
      for (const inst of INSTRUMENTS) {
        if (S.locks[inst.id]) continue;                    /* a locked row keeps what it has */
        S.steps[inst.id] = M.randomRow(S.len, S.density, inst.id, Math.random, S.trip);
        sendRow(inst.id);
      }
      repaintCells(); queueSave();
    }

    /* ------------------------------ sync UI ---------------------------- */
    function paintTransport() {
      clear(playBtn);
      playBtn.appendChild(icon(S.playing ? 'square' : 'play', { fill: !S.playing }));
      const what = S.playing ? 'Stop' : S.view === 'song' ? 'Play song' : 'Play';
      playBtn.appendChild(h('span', { text: what }));
      playBtn.setAttribute('aria-label', S.playing && S.playMode === 'song' ? 'Stop the song' : what);
      playBtn.classList.toggle('is-playing', S.playing);
      posEl.textContent = !S.playing ? 'Stopped'
        : S.playMode === 'song' ? (S.sp && S.sp.drawBar >= 0 ? `Bar ${S.sp.drawBar + 1} / ${S.sp.plan.bars.length}` : 'Starting…')
        : `Step ${Math.max(1, S.drawStep + 1)} / ${S.len}`;
    }
    function syncTempoUI() { bpmVal.textContent = `${S.bpm}`; bpmRange.value = String(S.bpm); }
    function syncSwingUI() { swVal.textContent = S.trip ? 'off' : `${Math.round(S.swing * 100)}%`; swRange.value = String(Math.round(S.swing * 100)); swRange.disabled = S.trip; }
    function syncShapeUI() {
      lenNum.textContent = `${S.len}`;
      tripBtn.setAttribute('aria-pressed', String(S.trip)); tripBtn.classList.toggle('is-on', S.trip);
      syncSwingUI();
    }
    function syncChips() {
      countBtn.setAttribute('aria-pressed', String(S.countIn)); countBtn.classList.toggle('is-on', S.countIn);
      tuneBtn.setAttribute('aria-pressed', String(S.tune)); tuneBtn.classList.toggle('is-on', S.tune);
      rowsWrap.classList.toggle('is-tuning', S.tune);
      for (const b of levelBtns) { const on = +b.dataset.level === S.level; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); }
    }
    function syncUndo() { undoBtn.disabled = !S.hist.length; redoBtn.disabled = !S.redo.length; }
    function syncRowUI(id) {
      const head = rowEls[id]._head;
      head.classList.toggle('is-muted', S.mutes[id]);
      head.classList.toggle('is-locked', !!S.locks[id]);
      head._mute.setAttribute('aria-pressed', S.mutes[id] ? 'true' : 'false');
      clear(head._mute);
      head._mute.appendChild(icon(S.mutes[id] ? 'volume-x' : 'volume'));
      head._mute.appendChild(h('span.beats__mutename', { text: nameOf(id) }));
      if (S.locks[id]) head._mute.appendChild(icon('lock'));
      head._vol.value = String(Math.round(S.vols[id] * 100));
      head._pitch.value = String(S.pitch[id]); head._pout.textContent = `${S.pitch[id] > 0 ? '+' : ''}${S.pitch[id]} st`;
      head._decay.value = String(Math.round(S.decay[id] * 100)); head._dout.textContent = `${Math.round(S.decay[id] * 100)}%`;
    }

    /* ------------------------------- jam ------------------------------- */
    const paired = () => !!S.room && S.room.phase === 'paired';
    function sendRoom(t, body) {
      if (!paired()) return false;
      if (!S.lim.ok()) return false;
      try { return S.room.send(t, body); } catch (e) { return false; }
    }
    function sendShape() { sendRoom('g', { len: S.len, tr: S.trip ? 1 : 0, bpm: S.bpm, sw: S.swing }); }
    function sendRow(id) { sendRoom('row', { r: IDS.indexOf(id), c: S.steps[id].slice() }); }
    function sendRowSet(id) { sendRoom('rs', { r: IDS.indexOf(id), p: S.pitch[id], d: S.decay[id], vo: Math.round(S.vols[id] * 100), m: S.mutes[id] ? 1 : 0 }); }
    function sendSnap() { S.lim = limiter(40, 1000); sendRoom('snap', { len: S.len, tr: S.trip ? 1 : 0, bpm: S.bpm, sw: S.swing, rows: IDS.map(id => S.steps[id].slice()) }); IDS.forEach(sendRowSet); }
    function onRoomMsg({ t, m }) {
      if (t === 'g') { S.bpm = m.bpm; S.swing = m.sw; setShape(m.len, !!m.tr, true); syncTempoUI(); syncShapeUI(); queueSave(); }
      else if (t === 'c') { const id = IDS[m.r]; if (m.s < S.len) setCell(id, m.s, m.l, true); }
      else if (t === 'row') { const id = IDS[m.r]; if (m.c.length === S.len) { S.steps[id] = m.c.slice(); for (let s = 0; s < S.len; s++) paintCell(id, s); queueSave(); } }
      else if (t === 'rs') { const id = IDS[m.r]; S.pitch[id] = m.p; S.decay[id] = m.d; S.vols[id] = m.vo / 100; S.mutes[id] = !!m.m; applyRowGain(id); syncRowUI(id); queueSave(); }
      else if (t === 'snap') {
        S.bpm = m.bpm; S.swing = m.sw; setShape(m.len, !!m.tr, true);
        IDS.forEach((id, i) => { S.steps[id] = m.rows[i].slice(); });
        repaintCells(); syncTempoUI(); syncShapeUI(); queueSave();
      }
    }
    function closeRoom() {
      S.roomOffs.forEach(f => f()); S.roomOffs = [];
      if (S.room) { try { S.room.leave(); } catch (e) {} }
      S.room = null; S.peer = null;
      paintRoom();
    }
    function openRoom(role, code) {
      closeRoom();
      let room;
      try { room = openPair({ kind: 'beats', role, code, types: BEATS_TYPES, rtc: false }); } catch (e) { jamNote = 'Couldn’t open a room here.'; paintRoom(); return; }
      S.room = room;
      jamNote = '';
      if (room.phase === 'closed') { jamNote = room.error === 'invalid' ? 'That isn’t a room code.' : room.error === 'full' ? 'That room already has two people.' : room.error === 'insecure' ? 'Rooms need a secure (https) page.' : 'Nobody is in that room.'; S.room = null; paintRoom(); return; }
      S.roomOffs = [room.on((type, data) => {
        if (S.dead || S.room !== room) return;
        if (type === 'phase') { if (data === 'closed') { jamNote = room.error ? 'Nobody is in that room.' : ''; closeRoom(); } paintRoom(); }
        else if (type === 'peer') { S.peer = data; if (room.role === 'host') { sendSnap(); setTimeout(() => { if (S.room === room && paired()) sendSnap(); }, 1500); } paintRoom(); }
        else if (type === 'left') { jamNote = `${data?.peer?.name || 'Your friend'} left.`; closeRoom(); }
        else if (type === 'msg') onRoomMsg(data);
      })];
      paintRoom();
    }
    let jamNote = '';
    let jamBox = null;
    function paintRoom() {
      roomStat.textContent = paired() ? `Jamming with ${S.peer?.name || 'a friend'}` : S.room ? 'Waiting for a friend…' : '';
      jamBtn.classList.toggle('is-on', !!S.room);
      if (jamBox) buildJam();
    }
    async function buildJam() {
      if (!jamBox) return;
      const body = jamBox;
      body.replaceChildren();
      if (!S.room) {
        const input = h('input.beats__sheetin', { type: 'text', placeholder: 'Room code', 'aria-label': 'Room code', maxlength: '24', autocomplete: 'off' });
        const go = () => { const c = normalizeCode(input.value); if (!isCode(c)) { jamNote = 'That isn’t a room code: it is six letters and numbers.'; buildJam(); return; } openRoom('guest', c); };
        input.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); go(); } });
        body.append(
          h('p.beats__sheetnote', { text: 'Make a beat with a friend on the same grid. Start a room and send them the code, or type theirs. Only people you give the code to can join; treat it like a password.' }),
          h('button.btn.btn--primary', { type: 'button', dataset: { jam: 'host' }, onclick: () => openRoom('host') }, h('span', { text: 'Start a room' })),
          h('div.beats__sheetrow', input, h('button.btn', { type: 'button', dataset: { jam: 'join' }, onclick: go }, h('span', { text: 'Join' }))));
      } else {
        const code = S.room.code;
        body.append(
          code ? h('div.beats__code', { dataset: { jam: 'code' }, 'aria-label': `Room code ${spaced(code)}`, text: code }) : null,
          h('p.beats__sheetnote', { text: paired() ? `You and ${S.peer?.name || 'your friend'} are on the same grid. Each of you hears it from your own device.` : 'Waiting for your friend. Give them this code, or invite a friend below.' }),
          h('button.btn', { type: 'button', dataset: { jam: 'leave' }, onclick: () => { closeRoom(); jamNote = ''; buildJam(); } }, h('span', { text: 'Leave the room' })));
        if (code && S.room.role === 'host' && !paired()) { try { body.append(await invitePanel({ h, icon, kind: 'beats', code })); } catch (e) { /* no friends */ } }
      }
      if (jamNote) body.append(h('p.beats__sheetnote.beats__sheeterr', { role: 'status', text: jamNote }));
      body.append(h('p.beats__sheetnote', { text: 'Rooms run over StaticOS’s live connection, a free public server: messages are sealed with the code, and a little delay is normal.' }));
    }
    function openJamSheet() {
      if (sheet) return;
      jamBox = h('div.beats__jam');
      const card = h('div.beats__sheet', { role: 'dialog', 'aria-label': 'Jam with a friend' },
        h('div.beats__sheettitle', { text: 'Jam with a friend' }), jamBox,
        h('div.beats__sheetrow', h('button.btn.btn--sm', { type: 'button', onclick: closeJam }, h('span', { text: 'Close' }))));
      sheet = h('div.beats__scrim', { onpointerdown: ev => { if (ev.target === sheet) closeJam(); } }, card);
      beatsEl.appendChild(sheet);
      buildJam();
    }
    function closeJam() { jamBox = null; closeSheet(); }
    const fromOpts = o => { if (o && o.join) { const c = normalizeCode(o.join).slice(0, 6); if (isCode(c)) { openJamSheet(); openRoom('guest', c); } } };
    if (win.onReopen) win.onReopen(fromOpts);

    /* ----------------------------- keyboard ---------------------------- */
    const onKey = e => {
      if (!win.el.classList.contains('is-active')) return;
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && S.view === 'pattern') {
        const k = e.key.toLowerCase();
        if (k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
        else if (k === 'y') { e.preventDefault(); redo(); }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      else if (S.view !== 'pattern') return;           /* the arrows are the grid's tempo */
      else if (e.key === 'ArrowUp') { e.preventDefault(); setBpm(S.bpm + (e.shiftKey ? 5 : 1)); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setBpm(S.bpm - (e.shiftKey ? 5 : 1)); }
    };
    window.addEventListener('keydown', onKey);

    /* prefs → output */
    S.unsub.push(store.sub('prefs.volume', applyMaster));
    S.unsub.push(store.sub('prefs.muted', () => { applyMaster(); syncTools(); }));

    /* ------------------------------ boot ------------------------------- */
    const saved = beatsData();
    if (saved.last) loadSnapshot(saved.last); else { const g = M.presetGrid(M.PRESETS[0]); loadSnapshot({ ...g }); }
    S.song = readSong();
    S.loopSong = !!(saved.song && saved.song.loop);
    S.countIn = saved.countIn === true;
    rebuildGrid();
    for (const id of IDS) syncRowUI(id);
    syncTempoUI(); syncSwingUI(); syncShapeUI(); syncTools(); syncMelUI(); syncChips(); syncUndo();
    setLane('drums');
    setView(saved.view === 'song' ? 'song' : 'pattern');
    /* the library changed in another Beats window or by a backup restore */
    S.unsub.push(store.sub('portal.beats', () => {
      if (S.dead) return;
      const now = readSong();
      if (JSON.stringify(now) !== JSON.stringify(S.song)) { if (S.playMode === 'song') stop(); S.song = now; }
      if (S.view === 'song' && !sheet) paintSong();
    }));
    beatsEl.beatsPeek = () => ({ ...snapshot(), room: S.room ? { phase: S.room.phase, code: S.room.code, role: S.room.role } : null, hist: S.hist.length, redo: S.redo.length, level: S.level, locks: { ...S.locks } });
    beatsEl.beatsRoom = () => S.room;                    /* play-tests only */
    fromOpts(ctx.opts);

    /* ----------------------------- teardown ---------------------------- */
    return () => {
      S.dead = true;
      stop();
      closeRoom();
      if (S.saveTimer) { clearTimeout(S.saveTimer); S.saveTimer = 0; /* flush the last edit */
        const d = beatsData();
        writeBeats({ patterns: Array.isArray(d.patterns) ? d.patterns : [], last: snapshot() });
      }
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerup', onCellUp);
      window.removeEventListener('pointerup', onRollUp);
      S.unsub.forEach(fn => { try { fn(); } catch (e) {} });
      S.unsub = [];
      closeSheet();
      if (S.melSyn) { try { S.melSyn.dispose(); } catch (e) {} S.melSyn = null; }
      if (S.ac) { try { S.ac.close(); } catch (e) {} S.ac = null; }
    };
  },
});

/* read-only helpers for Loop Station and Soundboard (js/core/beatsrender.js) */
export { VOICES, INSTRUMENTS, makeNoise, songPlan, stepHits, stepMelody, melPatch, normPattern };
