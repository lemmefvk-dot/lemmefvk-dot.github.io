/* ============================================================
   piano.js — Static Piano

   A playable, fully synthesised keyboard. There are no audio
   files anywhere: every note is built from oscillators the moment
   you press a key, and the whole thing runs off ONE AudioContext
   that is created lazily (browsers refuse audio before a gesture)
   and closed again in teardown.

   How it works:
   · Each held note is a small voice — one or two oscillators into a
     per-note gain that plays a short attack/decay/sustain envelope.
     "FM Bell" adds a modulator oscillator driving the carrier's
     frequency; "Pluck" is a quick-decaying triangle and "Organ" a sine
     with two overtones that holds as long as the key. Every voice
     feeds a shared master gain → soft compressor → the speakers, and a
     send to a small reverb (the Reverb slider; off by default).
   · Loudness is the OS's own prefs.volume / prefs.muted (read live)
     multiplied by this app's own volume knob, so muting the system
     really does mute the piano.
   · Sustain is a real pedal for every way of playing — on-screen keys,
     the computer keyboard, MIDI and playback: a key let go while it is
     on keeps sounding (fading slowly) until the pedal comes up, and
     the MIDI pedal does the same. Notes are reference-counted per
     source, so the mouse and the computer keyboard can hold the same
     key without one cutting the other off.
   · Record captures {time, note, on/off, voice} and the pedal; Play
     replays that stream with real timers while the notes fall onto the
     keys; Save renders the take through an OfflineAudioContext to a
     genuine 16-bit WAV that opens in the Music and Files apps, and
     "Save .mid" writes a Standard MIDI File (js/core/midi.js). A .mid
     from your own Files can be loaded as a take and replayed. Up to ten
     named takes are kept. A count-in and the metronome (an audio-clock
     look-ahead scheduler, so its clicks don't drift) can lead recording
     and playback.
   · Learn (js/core/tunes.js): public-domain tunes entered by hand. The
     next key to press is lit and the notes to come fall towards it. It
     waits for you; hits and misses are counted only from keys you really
     press, and nothing is scored by time passing.
   · Chords and scales: a key and scale light up on the keyboard, and the
     chord buttons play the chord on that root.
   · Duet: a room code (js/core/pair.js, kind 'piano') puts you and a
     friend on one keyboard; each hears the other's notes (js/core/
     instpair.js: small validated messages, rate-limited). Friends and
     codes only.

   The mapping a·w·s·e·d… (GarageBand style) is printed on the keys,
   and z / x shift the octave.

   MIDI keyboards (js/core/midi.js): the MIDI switch asks the browser for
   access only when it is turned on — never at load, and it starts off
   every time. Note on/off arrive with velocity (a soft key is quieter),
   the sustain pedal holds released notes until it comes up, and keyboards
   plugged in or pulled out are followed live. Where Web MIDI is missing
   or refused, the panel says so.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import media from '../core/media.js';
import { createMidi, describe as describeMidi, readSMF, writeSMF } from '../core/midi.js';
import { TUNES, schedule as tuneSchedule, learner } from '../core/tunes.js';
import { openPair } from '../core/pair.js';
import { isCode, normalizeCode, spaced } from '../core/roomcode.js';
import { PIANO_TYPES, VOICE_IDS, limiter } from '../core/instpair.js';
import { invitePanel } from '../core/friendinvite.js';
import { chooser } from '../core/filechoose.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-piano-css')) {
  const l = document.createElement('link');
  l.id = 'feat-piano-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-piano.css';
  document.head.appendChild(l);
}

/* ---------- music theory ---------- */
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const isBlack = m => NAMES[((m % 12) + 12) % 12].includes('#');
const noteName = m => NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
const freqOf = m => 440 * Math.pow(2, (m - 69) / 12);

/* GarageBand-style typing map: letter → semitone offset from the low C on screen */
const KEYMAP = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ';': 16 };
const LETTER_FOR = {};
for (const [k, off] of Object.entries(KEYMAP)) if (LETTER_FOR[off] === undefined) LETTER_FOR[off] = k;

const WHITE_COUNT = 15;                 /* C..C, two octaves + top C */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* per-voice peak amplitude (square/tri read louder, so pull them down).
   env: this voice's own decay time and sustain level (the others use ENV);
   add: extra overtones [frequency ratio, level] */
const VOICES = {
  sine:     { label: 'Sine',     type: 'sine',     peak: 0.24 },
  triangle: { label: 'Triangle', type: 'triangle', peak: 0.20 },
  square:   { label: 'Square',   type: 'square',   peak: 0.13 },
  fm:       { label: 'FM Bell',  type: 'sine',     peak: 0.22, fm: { ratio: 2, index: 3, decay: 0.6 } },
  pluck:    { label: 'Pluck',    type: 'triangle', peak: 0.26, env: { d: 0.5, s: 0.03 }, add: [[2, 0.25]] },
  organ:    { label: 'Organ',    type: 'sine',     peak: 0.16, env: { d: 0.05, s: 0.9 }, add: [[2, 0.5], [4, 0.25], [0.5, 0.4]] },
};
const ENV = { a: 0.006, d: 0.30, s: 0.42, rShort: 0.16, rLong: 1.35 };
const envOf = name => ({ d: VOICES[name]?.env?.d ?? ENV.d, s: VOICES[name]?.env?.s ?? ENV.s });
const MAX_TAKES = 10, MAX_EVENTS = 4000;
const SCALES = {
  off: { label: 'No scale', iv: null },
  major: { label: 'Major', iv: [0, 2, 4, 5, 7, 9, 11] },
  minor: { label: 'Natural minor', iv: [0, 2, 3, 5, 7, 8, 10] },
  pentMaj: { label: 'Major pentatonic', iv: [0, 2, 4, 7, 9] },
  pentMin: { label: 'Minor pentatonic', iv: [0, 3, 5, 7, 10] },
  blues: { label: 'Blues', iv: [0, 3, 5, 6, 7, 10] },
};
const CHORDS = {
  maj: { label: 'Major', iv: [0, 4, 7] }, min: { label: 'Minor', iv: [0, 3, 7] }, dom7: { label: '7th', iv: [0, 4, 7, 10] },
  min7: { label: 'Minor 7th', iv: [0, 3, 7, 10] }, dim: { label: 'Diminished', iv: [0, 3, 6] }, sus4: { label: 'Sus4', iv: [0, 5, 7] },
};

/* a small hall: decaying noise, the same for live and offline */
function makeIR(actx) {
  const len = Math.floor(actx.sampleRate * 1.6), ir = actx.createBuffer(2, len, actx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    let seed = 4242 + c * 911;
    for (let i = 0; i < len; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; d[i] = ((seed / 4294967296) * 2 - 1) * Math.pow(1 - i / len, 2.4); }
  }
  return ir;
}

/* build the visible keys starting at a C */
function buildBoard(baseMidi) {
  const white = [], black = [];
  let wi = 0, midi = baseMidi;
  while (white.length < WHITE_COUNT) {
    if (isBlack(midi)) black.push({ midi, leftWhite: wi - 1 });
    else { white.push({ midi, wi }); wi++; }
    midi++;
  }
  return { white, black, lastMidi: white[white.length - 1].midi };
}

defineApp({
  id: 'piano',
  name: 'Static Piano',
  icon: 'music',
  g1: '#bb6ff8', g2: '#6a1cc4',
  category: 'Media',
  keywords: ['piano', 'keyboard', 'synth', 'music', 'notes', 'instrument', 'record', 'octave', 'metronome', 'learn', 'midi', 'chords', 'scale', 'duet', 'organ', 'pluck', 'reverb'],
  desc: 'Play, record, learn tunes and jam on a synthesised piano',
  singleton: true,
  win: { w: 820, h: 700, minW: 400, minH: 420 },
  /* keys listed on the shortcut sheet (hold ⌘ / Ctrl): each one is bound below */
  shortcuts: [
    ['A / W / S / E / D / F / T / G / Y / H / U / J / K', 'Play the notes (the letters are printed on the keys; O L P ; go higher)'],
    ['Z / X', 'Octave down / up'],
  ],

  mount(ctx) {
    const { root, win, api } = ctx;
    const { h, icon, store, notify } = api;

    const K = 'portal.piano';
    const saved = store.get(K + '.settings') || {};
    const reduced = () => !!store.get('prefs.reduceMotion')
      || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

    /* ---------------- state ---------------- */
    const S = {
      voice: VOICES[saved.voice] ? saved.voice : 'sine',
      octave: clamp(Number.isFinite(saved.octave) ? saved.octave : 4, 1, 6),
      volume: clamp(Number.isFinite(saved.volume) ? saved.volume : 80, 0, 100),
      sustain: !!saved.sustain,
      bpm: clamp(Number.isFinite(saved.bpm) ? saved.bpm : 100, 40, 208),
      reverb: clamp(Number.isFinite(saved.reverb) ? saved.reverb : 0, 0, 100),
      scaleRoot: clamp(Number.isFinite(saved.scaleRoot) ? saved.scaleRoot : 0, 0, 11),
      scale: SCALES[saved.scale] ? saved.scale : 'off',
      countIn: !!saved.countIn,
      metro: false,
      help: saved.help !== false,
    };
    let board = buildBoard((S.octave + 1) * 12);

    /* ---------------- audio ---------------- */
    let ac = null, master = null, comp = null, verb = null, verbSend = null;
    const voices = new Map();          /* midi -> { out, oscs, extra } */
    const held = new Map();            /* midi -> Set(source) */
    const sus = new Set();             /* notes let go of while the pedal was down */
    const relTimers = new Set();       /* release cleanup timers */
    const playTimers = new Set();      /* playback timers */
    let metroTimer = 0, metroNext = 0, metroBeat = 0;
    let pedalDown = false;             /* the MIDI pedal */
    let playPed = false;               /* the pedal in a take that is playing back */
    let lastPed = false;               /* the pedal as last written to a recording */

    const AC = window.AudioContext || window.webkitAudioContext;

    function volFactor() {
      const sys = clamp(Number(store.get('prefs.volume', 62)) || 0, 0, 100) / 100;
      const mute = store.get('prefs.muted', false) === true;
      return mute ? 0 : (S.volume / 100) * sys;
    }
    function ensureCtx() {
      if (ac) { if (ac.state === 'suspended') ac.resume().catch(() => {}); return ac; }
      if (!AC) return null;
      try { ac = new AC(); } catch (e) { ac = null; return null; }
      master = ac.createGain();
      master.gain.value = volFactor();
      comp = ac.createDynamicsCompressor();
      comp.threshold.value = -12; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.18;
      master.connect(comp); comp.connect(ac.destination);
      verb = ac.createConvolver(); verb.buffer = makeIR(ac);
      verbSend = ac.createGain(); verbSend.gain.value = S.reverb / 100 * 2;
      master.connect(verb); verb.connect(verbSend); verbSend.connect(comp);
      return ac;
    }
    function updateMaster() { if (master && ac) master.gain.setTargetAtTime(volFactor(), ac.currentTime, 0.02); }

    /* build (but don't start) the oscillators for one note */
    function makeVoice(actx, freq, voiceName) {
      const V = VOICES[voiceName] || VOICES.sine;
      const out = actx.createGain();
      const oscs = [], extra = [];
      const carrier = actx.createOscillator();
      carrier.type = V.type;
      carrier.frequency.value = freq;
      if (V.fm) {
        const mod = actx.createOscillator();
        mod.type = 'sine';
        mod.frequency.value = freq * V.fm.ratio;
        const modGain = actx.createGain();
        modGain.gain.value = freq * V.fm.index;
        mod.connect(modGain); modGain.connect(carrier.frequency);
        oscs.push(mod); extra.push(modGain);
      }
      for (const [ratio, level] of V.add || []) {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = 'sine'; o.frequency.value = freq * ratio; g.gain.value = level;
        o.connect(g); g.connect(out);
        oscs.push(o); extra.push(g);
      }
      carrier.connect(out);
      oscs.push(carrier);
      return { out, oscs, extra, peak: V.peak };
    }

    function startVoice(midi, voiceName, vel) {
      const actx = ensureCtx();
      if (!actx || voices.has(midi)) return;
      const t = actx.currentTime;
      const v = makeVoice(actx, freqOf(midi), voiceName);
      const env = envOf(voiceName);
      v.out.gain.setValueAtTime(0.0001, t);
      const pk = v.peak * velScale(vel);
      v.pk = pk;
      v.out.gain.linearRampToValueAtTime(pk, t + ENV.a);
      v.out.gain.linearRampToValueAtTime(pk * env.s, t + ENV.a + env.d);
      v.out.connect(master);
      v.oscs.forEach(o => o.start(t));
      voices.set(midi, v);
    }
    function stopVoice(midi) {
      const v = voices.get(midi);
      if (!v || !ac) return;
      voices.delete(midi);
      const t = ac.currentTime;
      const rel = S.sustain ? ENV.rLong : ENV.rShort;
      try {
        v.out.gain.cancelScheduledValues(t);
        v.out.gain.setTargetAtTime(0.0001, t, rel / 3);
      } catch (e) {}
      const stopAt = t + rel + 0.05;
      v.oscs.forEach(o => { try { o.stop(stopAt); } catch (e) {} });
      const id = setTimeout(() => {
        relTimers.delete(id);
        try { v.out.disconnect(); } catch (e) {}
        v.extra.forEach(n => { try { n.disconnect(); } catch (e) {} });
        v.oscs.forEach(o => { try { o.disconnect(); } catch (e) {} });
      }, (rel + 0.12) * 1000);
      relTimers.add(id);
    }
    /* the pedal holds a let-go note: it fades slowly instead of ringing for ever */
    function holdVoice(midi) {
      const v = voices.get(midi);
      if (!v || !ac) return;
      const t = ac.currentTime;
      try { v.out.gain.cancelScheduledValues(t); v.out.gain.setTargetAtTime(Math.max(0.0005, (v.pk || 0.1) * 0.08), t, 2.5); } catch (e) {}
    }

    /* ---------------- the pedal: the sustain switch, a MIDI pedal, a take's own ---------------- */
    const pedalOn = () => S.sustain || pedalDown || playPed;
    function settlePedal() {
      if (!pedalOn()) {
        for (const n of [...sus]) { sus.delete(n); if (!held.has(n)) { stopVoice(n); refreshKey(n); } }
      }
      notePed();
    }
    function notePed() {
      const cur = pedalOn();
      if (rec.on && ac && cur !== lastPed) rec.events.push({ t: ac.currentTime - rec.start, type: 'ped', down: cur });
      lastPed = cur;
    }

    /* ---------------- note routing (reference-counted per source) ---------------- */
    /* a key struck softly is quieter (mouse and keys have no velocity: full) */
    const velScale = v => (v == null ? 1 : 0.12 + 0.88 * clamp(v, 0, 1));
    const LOCAL = src => src !== 'play' && src !== 'peer' && src !== 'tune';
    function refreshKey(midi) {
      const el = keyEls.get(midi);
      if (!el) return;
      const s = held.get(midi);
      el.classList.toggle('is-down', !!s && [...s].some(x => x !== 'peer') || sus.has(midi));
      el.classList.toggle('is-peer', !!s && s.has('peer'));
    }
    function press(midi, source, voiceName, vel) {
      let s = held.get(midi);
      if (sus.has(midi)) { sus.delete(midi); stopVoice(midi); }        /* struck again: sound it afresh */
      if (!s) { s = new Set(); held.set(midi, s); startVoice(midi, voiceName || S.voice, vel); }
      s.add(source);
      refreshKey(midi);
      if (rec.on && ac && source !== 'play' && source !== 'peer') rec.events.push({ t: ac.currentTime - rec.start, midi, type: 'on', voice: voiceName || S.voice, ...(vel != null ? { vel } : {}) });
      if (LOCAL(source)) duetSend(midi, vel, true);
      if (source !== 'play' && source !== 'peer' && source !== 'chord') learnPress(midi);
    }
    function release(midi, source) {
      const s = held.get(midi);
      if (!s) return;
      s.delete(source);
      if (s.size === 0) {
        held.delete(midi);
        if (pedalOn()) { sus.add(midi); holdVoice(midi); } else stopVoice(midi);
        refreshKey(midi);
        if (rec.on && ac && source !== 'play' && source !== 'peer') rec.events.push({ t: ac.currentTime - rec.start, midi, type: 'off' });
        if (LOCAL(source)) duetSend(midi, 0, false);
      } else refreshKey(midi);
    }
    /* a single keyboard/tap "click" with no matching release (a11y activation) */
    function pluck(midi) {
      press(midi, 'pluck');
      const id = setTimeout(() => { release(midi, 'pluck'); relTimers.delete(id); }, 380);
      relTimers.add(id);
    }

    /* ---------------- recording, takes, count-in ---------------- */
    const rec = { on: false, start: 0, events: (store.get(K + '.take') || []).filter(e => e && (e.type === 'on' || e.type === 'off' || e.type === 'ped')).slice(0, MAX_EVENTS), voiceAtStart: 'sine' };
    let playing = false, counting = false, countT = 0, playStart = 0, laneRaf = 0;

    function cancelCount() { if (countT) { clearTimeout(countT); countT = 0; } counting = false; }
    /* four clicks, one to a beat, then fn; with Count-in off, fn at once */
    function withCountIn(fn) {
      if (!S.countIn) { fn(); return; }
      if (!ensureCtx()) { fn(); return; }
      const beat = 60 / S.bpm, t0 = ac.currentTime + 0.06;
      counting = true;
      for (let i = 0; i < 4; i++) metroClick(t0 + i * beat, i === 0);
      let n = 0;
      const tick = () => { n++; recTime.textContent = `count-in ${n}`; };
      tick();
      for (let i = 1; i < 4; i++) playTimers.add(setTimeout(tick, (0.06 + i * beat) * 1000));
      countT = setTimeout(() => { countT = 0; counting = false; fn(); }, (0.06 + 4 * beat) * 1000);
      updateTransport();
    }
    function toggleRecord() {
      if (counting) { cancelCount(); updateTransport(); return; }
      if (playing) stopPlayback();
      if (rec.on) {
        rec.on = false;
        store.set(K + '.take', rec.events.slice());
        updateTransport();
        return;
      }
      ensureCtx();
      if (!ac) { notify({ app: 'Static Piano', icon: 'alert', title: 'No audio', message: 'This browser blocked the audio engine.' }); return; }
      withCountIn(() => {
        rec.events = [];
        rec.start = ac.currentTime;
        rec.on = true;
        lastPed = false; notePed();
        if (S.metro) restartMetro();                 /* the click starts on the take's first beat */
        updateTransport();
      });
      updateTransport();
    }
    function playRecording() {
      if (counting) { cancelCount(); updateTransport(); return; }
      if (playing) { stopPlayback(); return; }
      if (rec.on) toggleRecord();
      if (!rec.events.length) { notify({ app: 'Static Piano', icon: 'info', title: 'Nothing recorded', message: 'Press Record, play some notes, then Play.' }); return; }
      if (!ensureCtx()) return;
      withCountIn(startPlayback);
      updateTransport();
    }
    function startPlayback() {
      playing = true;
      fitOctave(pairEvents(rec.events));
      if (S.metro) restartMetro();
      playStart = performance.now();
      for (const ev of rec.events) {
        const id = setTimeout(() => {
          playTimers.delete(id);
          if (ev.type === 'ped') { playPed = !!ev.down; settlePedal(); return; }
          if (ev.type === 'on') press(ev.midi, 'play', ev.voice, ev.vel);
          else release(ev.midi, 'play');
        }, Math.max(0, ev.t * 1000));
        playTimers.add(id);
      }
      const end = (rec.events[rec.events.length - 1].t + 0.4) * 1000;
      playTimers.add(setTimeout(() => stopPlayback(), end));
      lane.mode = 'play'; lane.pairs = pairEvents(rec.events); laneEl.hidden = false;
      laneLoop();
      updateTransport();
    }
    function stopPlayback() {
      playTimers.forEach(clearTimeout); playTimers.clear();
      for (const [midi, s] of [...held]) if (s.has('play')) release(midi, 'play');
      playing = false; playPed = false; settlePedal();
      if (lane.mode === 'play') { lane.mode = null; if (laneRaf) cancelAnimationFrame(laneRaf); laneRaf = 0; laneEl.hidden = !learn.on; if (learn.on) drawLane(); }
      updateTransport();
    }
    function clearTake() {
      cancelCount();
      if (playing) stopPlayback();
      if (rec.on) toggleRecord();
      rec.events = [];
      store.set(K + '.take', []);
      updateTransport();
    }

    /* ---------------- metronome (look-ahead scheduler on the audio clock) ---------------- */
    function metroClick(when, accent) {
      if (!ac) return;
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'square';
      o.frequency.value = accent ? 1600 : 1000;
      g.gain.setValueAtTime(0.0001, when);
      g.gain.linearRampToValueAtTime(0.14, when + 0.001);
      g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
      o.connect(g); g.connect(master);
      o.start(when); o.stop(when + 0.06);
    }
    function metroTick() {
      if (!ac) return;
      const spb = 60 / S.bpm;
      while (metroNext < ac.currentTime + 0.12) {
        metroClick(metroNext, metroBeat % 4 === 0);
        metroNext += spb;
        metroBeat++;
      }
    }
    function restartMetro() { if (!ac) return; metroBeat = 0; metroNext = ac.currentTime + 0.03; metroTick(); }
    function setMetro(on) {
      S.metro = on;
      if (on) {
        if (!ensureCtx()) { S.metro = false; return; }
        restartMetro();
        metroTimer = setInterval(metroTick, 25);
      } else {
        clearInterval(metroTimer); metroTimer = 0;
      }
      if (btnMetro) btnMetro.classList.toggle('is-on', S.metro);
    }

    /* ---------------- pairing note events, WAV and MIDI export ---------------- */
    /* { midi, on, off, voice, vel }; with the pedal down a let-go note ends when the pedal comes up */
    function pairEvents(events) {
      const open = new Map(), out = [];
      let ped = false, later = [], last = 0;
      for (const ev of events) {
        last = Math.max(last, ev.t);
        if (ev.type === 'ped') {
          ped = !!ev.down;
          if (!ped) { for (const o of later) out.push({ ...o, off: ev.t }); later = []; }
        } else if (ev.type === 'on') {
          open.set(ev.midi, { midi: ev.midi, on: ev.t, voice: ev.voice, vel: ev.vel });
        } else {
          const o = open.get(ev.midi);
          if (!o) continue;
          open.delete(ev.midi);
          if (ped) later.push({ ...o, held: ev.t }); else out.push({ ...o, off: ev.t });
        }
      }
      for (const o of later) out.push({ ...o, off: last + 0.5 });
      for (const [, o] of open) out.push({ ...o, off: o.on + 0.5 });
      return out.sort((a, b) => a.on - b.on);
    }
    function encodeWav(buf) {
      const chans = buf.numberOfChannels, len = buf.length, sr = buf.sampleRate;
      const bytes = 44 + len * chans * 2;
      const ab = new ArrayBuffer(bytes), dv = new DataView(ab);
      const ws = (off, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)); };
      ws(0, 'RIFF'); dv.setUint32(4, bytes - 8, true); ws(8, 'WAVE');
      ws(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, chans, true);
      dv.setUint32(24, sr, true); dv.setUint32(28, sr * chans * 2, true); dv.setUint16(32, chans * 2, true); dv.setUint16(34, 16, true);
      ws(36, 'data'); dv.setUint32(40, len * chans * 2, true);
      let off = 44;
      const data = [];
      for (let c = 0; c < chans; c++) data.push(buf.getChannelData(c));
      for (let i = 0; i < len; i++) {
        for (let c = 0; c < chans; c++) {
          const v = clamp(data[c][i], -1, 1);
          dv.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7fff, true);
          off += 2;
        }
      }
      return new Blob([ab], { type: 'audio/wav' });
    }
    const stampNow = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    async function exportWav() {
      if (rec.on) toggleRecord();
      if (!rec.events.length) { notify({ app: 'Static Piano', icon: 'info', title: 'Nothing to save', message: 'Record a take first.' }); return; }
      if (typeof OfflineAudioContext === 'undefined') { notify({ app: 'Static Piano', icon: 'alert', title: 'Not supported', message: 'This browser can\'t render offline audio.' }); return; }
      const pairs = pairEvents(rec.events);
      const dur = Math.max(...pairs.map(p => p.off)) + (S.reverb ? 3 : 2);
      const sr = 44100;
      btnExport.disabled = true;
      try {
        const off = new OfflineAudioContext(2, Math.ceil(dur * sr), sr);
        const m = off.createGain(); m.gain.value = 0.9;
        const cp = off.createDynamicsCompressor();
        cp.threshold.value = -12; cp.ratio.value = 4;
        m.connect(cp); cp.connect(off.destination);
        if (S.reverb) {
          const cv = off.createConvolver(); cv.buffer = makeIR(off);
          const send = off.createGain(); send.gain.value = S.reverb / 100 * 2;
          m.connect(cv); cv.connect(send); send.connect(cp);
        }
        for (const p of pairs) {
          const v = makeVoice(off, freqOf(p.midi), p.voice || 'sine');
          const env = envOf(p.voice || 'sine');
          const on = p.on, offT = Math.max(p.off, on + 0.05);
          const pk = v.peak * velScale(p.vel);
          v.out.gain.setValueAtTime(0.0001, on);
          v.out.gain.linearRampToValueAtTime(pk, on + ENV.a);
          v.out.gain.linearRampToValueAtTime(pk * env.s, on + ENV.a + env.d);
          if (p.held != null && p.held < offT) v.out.gain.setTargetAtTime(Math.max(0.0005, pk * 0.08), Math.max(on + 0.01, p.held), 2.5);
          v.out.gain.setTargetAtTime(0.0001, offT, ENV.rShort / 3);
          v.out.connect(m);
          v.oscs.forEach(o => { o.start(on); o.stop(offT + ENV.rShort + 0.1); });
        }
        const rendered = await off.startRendering();
        const blob = encodeWav(rendered);
        const { path } = await media.save(api.vfs.HOME + '/Music', `Piano take ${stampNow()}.wav`, blob);
        notify({
          app: 'Static Piano', icon: 'save', title: 'Saved to Music',
          message: api.vfs.baseName ? api.vfs.baseName(path) : path,
          actions: [{ label: 'Open in Music', onClick: () => api.openApp('music') }],
        });
      } catch (e) {
        notify({ app: 'Static Piano', icon: 'alert', title: 'Export failed', message: String(e && e.message || e) });
      } finally {
        btnExport.disabled = false;
      }
    }
    /* a Standard MIDI File of the take, at the tempo on the slider */
    async function exportMidiFile() {
      const pairs = pairEvents(rec.events);
      if (!pairs.length) { say('Record a take first.'); return null; }
      try {
        const ppq = 480, tpS = ppq * S.bpm / 60;
        const notes = pairs.map(p => ({ tick: p.on * tpS, dur: Math.max(1, (p.off - p.on) * tpS), note: p.midi, vel: p.vel == null ? 0.8 : p.vel }));
        const bytes = writeSMF({ bpm: S.bpm, ppq, tracks: [{ name: 'Piano', ch: 0, notes }] });
        const { path } = await media.save(api.vfs.HOME + '/Music', `Piano take ${stampNow()}.mid`, new Blob([bytes], { type: 'audio/midi' }));
        say(`Saved ${api.vfs.baseName(path)} to Music (${pairs.length} notes).`);
        return { path, notes: pairs.length };
      } catch (e) { say('Could not save the MIDI file: ' + String(e && e.message || e)); return null; }
    }
    /* a .mid from the person's own Files becomes the take */
    async function importMidiFile(file) {
      try {
        const blob = await media.blobOf(file.path);
        if (!blob) { say('That file has no readable data.'); return; }
        const smf = readSMF(new Uint8Array(await blob.arrayBuffer()));
        if (!smf) { say(`${file.name} doesn’t look like a MIDI file, or it is too big (the limit is 4 MB).`); return; }
        const notes = smf.tracks.flatMap(t => t.notes).sort((a, b) => a.t - b.t).slice(0, 2000);
        if (!notes.length) { say(`${file.name} has no notes in it.`); return; }
        const ev = [];
        for (const n of notes) { ev.push({ t: n.t, midi: n.note, type: 'on', voice: S.voice, vel: n.vel }, { t: n.t + n.dur, midi: n.note, type: 'off' }); }
        ev.sort((a, b) => a.t - b.t || (a.type === 'off' ? -1 : 1));
        if (playing) stopPlayback();
        rec.events = ev;
        store.set(K + '.take', ev.slice(0, MAX_EVENTS));
        setBpm(smf.bpm);
        updateTransport();
        say(`Loaded ${notes.length} notes from ${file.name} (${smf.seconds.toFixed(1)} s). Press Play to watch them fall.`);
      } catch (e) { say('Could not read that file: ' + String(e && e.message || e)); }
    }

    /* ---------------- falling notes ---------------- */
    const lane = { mode: null, pairs: [] };
    const PXS = 110;                                  /* pixels a second falls */
    function fitOctave(pairs) {
      if (!pairs.length) return;
      const lo = Math.min(...pairs.map(p => p.midi));
      const next = clamp(Math.floor(lo / 12) - 1, 1, 6);
      if (next !== S.octave && Math.max(...pairs.map(p => p.midi)) - lo <= 24) setOctave(next);
    }
    function keyBox(midi) {
      const el = keyEls.get(midi);
      if (!el) return null;
      const r = el.getBoundingClientRect(), c = laneCv.getBoundingClientRect();
      return { x: r.left - c.left, w: r.width, black: el.classList.contains('pkey--black') };
    }
    function drawLane() {
      if (laneEl.hidden) return;
      const W = Math.max(60, Math.round(laneCv.clientWidth)), H = laneCv.clientHeight || 120;
      if (laneCv.width !== W) laneCv.width = W;
      if (laneCv.height !== H) laneCv.height = H;
      const g = laneCv.getContext('2d');
      g.clearRect(0, 0, W, H);
      const css = getComputedStyle(laneCv);
      const accent = css.getPropertyValue('--accent').trim() || '#bb6ff8';
      const soft = css.getPropertyValue('--accent-soft').trim() || accent;
      const block = (midi, y0, y1, color) => {
        const b = keyBox(midi);
        if (!b || y1 < 0 || y0 > H) return;
        const w = b.black ? b.w * 0.8 : b.w - 4, x = b.x + (b.w - w) / 2;
        g.fillStyle = color;
        g.globalAlpha = 0.9;
        g.beginPath(); g.roundRect ? g.roundRect(x, y0, w, Math.max(4, y1 - y0), 3) : g.rect(x, y0, w, Math.max(4, y1 - y0)); g.fill();
        g.globalAlpha = 1;
      };
      if (lane.mode === 'play') {
        const pos = (performance.now() - playStart) / 1000;
        for (const p of lane.pairs) {
          const top = H - (p.off - pos) * PXS, bottom = H - (p.on - pos) * PXS;
          block(p.midi, top, bottom, p.on <= pos && pos <= p.off ? accent : soft);
        }
      } else if (learn.on && learn.j) {
        const list = learn.list, st = learn.j.stats();
        for (let i = 0; i < 7 && st.pos + i < list.length; i++) {
          const y1 = H - 6 - i * 34;
          block(list[st.pos + i].midi, y1 - 26, y1, i === 0 ? accent : soft);
        }
      }
    }
    function laneLoop() {
      if (laneRaf) cancelAnimationFrame(laneRaf);
      const f = () => { drawLane(); laneRaf = lane.mode === 'play' ? requestAnimationFrame(f) : 0; };
      f();
    }

    /* ---------------- learn: public-domain tunes, scored from real key presses ---------------- */
    const learn = { on: false, tune: TUNES[0], j: null, list: [], miss: 0 };
    let hearTimers = [];
    function setOctave(n) {
      n = clamp(n, 1, 6);
      if (n === S.octave) return;
      allNotesOff();
      S.octave = n;
      board = buildBoard((S.octave + 1) * 12);
      boardWrap.replaceChildren(renderBoard());
      updateOctLabel(); paintScale(); paintTarget();
      saveSettings();
    }
    function learnStart(id) {
      stopHear();
      learn.tune = TUNES.find(t => t.id === id) || TUNES[0];
      learn.list = tuneSchedule(learn.tune).notes;
      learn.j = learner(learn.tune);
      learn.on = true;
      setOctave(4);
      laneEl.hidden = false;
      paintLearn(); drawLane();
    }
    function learnStop() {
      learn.on = false; learn.j = null;
      stopHear();
      if (lane.mode !== 'play') laneEl.hidden = true;
      paintLearn(); paintTarget();
    }
    function learnPress(midi) {
      if (!learn.on || !learn.j) return;
      const r = learn.j.press(midi);
      if (r === 'miss') { const el = keyEls.get(midi); if (el) { el.classList.add('is-wrong'); setTimeout(() => el.classList.remove('is-wrong'), 260); } }
      paintLearn(); drawLane();
    }
    function paintTarget() {
      for (const el of keyEls.values()) el.classList.remove('is-target');
      if (!learn.on || !learn.j) return;
      const n = learn.j.next();
      if (n != null) keyEls.get(n)?.classList.add('is-target');
    }
    function paintLearn() {
      paintTarget();
      const st = learn.j ? learn.j.stats() : null;
      learnBtn.textContent = learn.on ? 'Stop learning' : 'Start learning';
      learnBtn.setAttribute('aria-pressed', String(learn.on));
      if (!st) { learnStat.textContent = 'Pick a tune and press Start learning. The next key lights up; press it to go on.'; return; }
      if (st.done) learnStat.textContent = `Finished “${learn.tune.title}”: ${st.hits} right, ${st.misses} wrong, ${st.accuracy}% of your key presses were right.`;
      else learnStat.textContent = `Press ${noteName(learn.j.next())} · note ${st.pos + 1} of ${st.total} · ${st.hits} right, ${st.misses} wrong`;
    }
    /* hear the tune once, at its own tempo (not scored) */
    function stopHear() { hearTimers.forEach(clearTimeout); hearTimers = []; for (const [m, s] of [...held]) if (s.has('tune')) release(m, 'tune'); }
    function hearTune() {
      stopHear();
      if (!ensureCtx()) return;
      const t = learn.tune, spb = 60000 / t.bpm;
      for (const n of tuneSchedule(t).notes) {
        hearTimers.push(setTimeout(() => press(n.midi, 'tune'), n.at * spb));
        hearTimers.push(setTimeout(() => release(n.midi, 'tune'), (n.at + Math.min(n.len, 1) * 0.9) * spb));
      }
    }

    /* ---------------- duet: one keyboard, two friends ---------------- */
    const duet = { room: null, peer: null, offs: [], lim: limiter(40, 1000), sent: new Set(), peerVoice: 'sine', note: '', timers: new Map() };
    const paired = () => !!duet.room && duet.room.phase === 'paired';
    function duetSend(midi, vel, down) {
      if (!paired()) return;
      if (down) { if (!duet.lim.ok()) return; duet.sent.add(midi); }
      else if (!duet.sent.delete(midi)) return;
      try { duet.room.send('n', { m: midi, vl: Math.round((vel == null ? 1 : vel) * 100), d: down ? 1 : 0 }); } catch (e) { /* closing */ }
    }
    function peerAllOff() { for (const [m, s] of [...held]) if (s.has('peer')) release(m, 'peer'); for (const t of duet.timers.values()) clearTimeout(t); duet.timers.clear(); }
    function onDuetMsg({ t, m }) {
      if (t === 'vc') { duet.peerVoice = m.vc; }
      else if (t === 'ao') peerAllOff();
      else if (t === 'n') {
        if (m.d) {
          if (held.get(m.m)?.has('peer')) release(m.m, 'peer');
          press(m.m, 'peer', duet.peerVoice, m.vl / 100);
          clearTimeout(duet.timers.get(m.m));
          duet.timers.set(m.m, setTimeout(() => release(m.m, 'peer'), 15000));      /* a lost note-off never sticks */
        } else { clearTimeout(duet.timers.get(m.m)); duet.timers.delete(m.m); release(m.m, 'peer'); }
      }
    }
    function duetClose() {
      duet.offs.forEach(f => f()); duet.offs = [];
      peerAllOff();
      if (duet.room) { try { duet.room.leave(); } catch (e) {} }
      duet.room = null; duet.peer = null; duet.sent.clear();
      paintDuet();
    }
    function duetOpen(role, code) {
      duetClose();
      let room;
      try { room = openPair({ kind: 'piano', role, code, types: PIANO_TYPES, rtc: false }); } catch (e) { duet.note = 'Couldn’t open a room here.'; paintDuet(); return; }
      duet.room = room; duet.note = '';
      if (room.phase === 'closed') { duet.note = room.error === 'invalid' ? 'That isn’t a room code.' : room.error === 'full' ? 'That room already has two people.' : room.error === 'insecure' ? 'Rooms need a secure (https) page.' : 'Nobody is in that room.'; duet.room = null; paintDuet(); return; }
      duet.offs = [room.on((type, data) => {
        if (duet.room !== room) return;
        if (type === 'phase') { if (data === 'closed') { duet.note = room.error ? 'Nobody is in that room.' : ''; duetClose(); } else paintDuet(); }
        else if (type === 'peer') { duet.peer = data; try { room.send('vc', { vc: VOICE_IDS.includes(S.voice) ? S.voice : 'sine' }); } catch (e) {} setTimeout(() => { if (duet.room === room && paired()) { try { room.send('vc', { vc: VOICE_IDS.includes(S.voice) ? S.voice : 'sine' }); } catch (e) {} } }, 1500); paintDuet(); }
        else if (type === 'left') { duet.note = `${data?.peer?.name || 'Your friend'} left.`; duetClose(); }
        else if (type === 'msg') onDuetMsg(data);
      })];
      paintDuet();
    }

    /* ---------------- UI ---------------- */
    const keyEls = new Map();          /* midi -> element */

    function renderBoard() {
      keyEls.clear();
      const whites = h('div.piano__whites');
      const blacks = h('div.piano__blacks');
      const total = board.white.length;
      const baseMidi = board.white[0].midi;

      for (const w of board.white) {
        const off = w.midi - baseMidi;
        const letter = LETTER_FOR[off];
        const el = h('button.pkey.pkey--white', {
          dataset: { midi: w.midi },
          'aria-label': noteName(w.midi),
          onclick: (e) => { if (e.detail === 0) pluck(w.midi); },
        },
          letter ? h('span.pkey__key', { text: letter === ';' ? ';' : letter }) : null,
          h('span.pkey__name', { text: noteName(w.midi) }),
        );
        keyEls.set(w.midi, el);
        whites.appendChild(el);
      }
      for (const b of board.black) {
        const off = b.midi - baseMidi;
        const letter = LETTER_FOR[off];
        const el = h('button.pkey.pkey--black', {
          dataset: { midi: b.midi },
          'aria-label': noteName(b.midi),
          style: { left: (((b.leftWhite + 1) / total) * 100) + '%', width: ((100 / total) * 0.62) + '%' },
          onclick: (e) => { if (e.detail === 0) pluck(b.midi); },
        }, letter ? h('span.pkey__key', { text: letter }) : null);
        keyEls.set(b.midi, el);
        blacks.appendChild(el);
      }
      const keys = h('div.piano__keys', { style: { minWidth: (total * 34) + 'px' } }, whites, blacks);
      return keys;
    }

    /* the scale lights up: its notes get a dot, its root a ring */
    function paintScale() {
      const sc = SCALES[S.scale].iv;
      for (const [midi, el] of keyEls) {
        const pc = ((midi % 12) + 12) % 12, rel = (pc - S.scaleRoot + 12) % 12;
        el.classList.toggle('in-scale', !!sc && sc.includes(rel));
        el.classList.toggle('is-root', !!sc && rel === 0);
      }
    }
    function playChord(q) {
      const c = CHORDS[q];
      let base = board.white[0].midi + S.scaleRoot;
      if (base + Math.max(...c.iv) > board.lastMidi) base -= 12;
      if (base < board.white[0].midi - 12) base = board.white[0].midi;
      const ns = c.iv.map(i => base + i);
      for (const n of ns) press(n, 'chord');
      const id = setTimeout(() => { relTimers.delete(id); for (const n of ns) release(n, 'chord'); }, 800);
      relTimers.add(id);
      say(`${NAMES[S.scaleRoot]} ${c.label}: ${ns.map(noteName).join(' ')}`);
    }

    /* --- controls --- */
    const voiceSeg = h('div.piano__seg', { role: 'group', 'aria-label': 'Instrument voice' });
    const voiceBtns = new Map();
    for (const [id, v] of Object.entries(VOICES)) {
      const b = h('button.piano__segbtn', {
        text: v.label,
        'aria-pressed': String(id === S.voice),
        onclick: () => setVoice(id),
      });
      voiceBtns.set(id, b);
      voiceSeg.appendChild(b);
    }
    function setVoice(id) {
      S.voice = id;
      voiceBtns.forEach((b, k) => { b.classList.toggle('is-on', k === id); b.setAttribute('aria-pressed', String(k === id)); });
      saveSettings();
      if (paired()) { try { duet.room.send('vc', { vc: id }); } catch (e) {} }
    }

    const octLabel = h('span.piano__octval', { 'aria-live': 'polite' });
    const octMinus = h('button.ibtn.tip', { 'data-tip': 'Octave down (z)', 'aria-label': 'Octave down', onclick: () => shiftOctave(-1) }, icon('chevron-down'));
    const octPlus = h('button.ibtn.tip', { 'data-tip': 'Octave up (x)', 'aria-label': 'Octave up', onclick: () => shiftOctave(1) }, icon('chevron-up'));
    function shiftOctave(d) { setOctave(S.octave + d); }
    function updateOctLabel() { octLabel.textContent = noteName(board.white[0].midi) + '–' + noteName(board.lastMidi); }

    const sustainSwitch = h('button.switch', { role: 'switch', 'aria-label': 'Sustain', 'aria-checked': String(S.sustain), onclick: () => setSustain(!S.sustain) });
    sustainSwitch.classList.toggle('is-on', S.sustain);
    function setSustain(on) {
      S.sustain = on;
      sustainSwitch.classList.toggle('is-on', on);
      sustainSwitch.setAttribute('aria-checked', String(on));
      saveSettings();
      settlePedal();
    }

    const volIcon = h('span.piano__volico');
    const volSlider = h('input.slider.piano__vol', {
      type: 'range', min: '0', max: '100', value: String(S.volume),
      'aria-label': 'Piano volume',
      oninput: (e) => { S.volume = clamp(Number(e.target.value) || 0, 0, 100); updateMaster(); paintVol(); saveSettings(); },
    });
    function paintVol() {
      const sysMuted = store.get('prefs.muted', false) === true;
      const muted = sysMuted || S.volume === 0;
      volIcon.replaceChildren(icon(muted ? 'volume-x' : 'volume-2'));
      volIcon.classList.toggle('is-muted', muted);
      volIcon.title = sysMuted ? 'System sound is muted' : (S.volume + '%');
    }
    const reverbSlider = h('input.slider.piano__reverb', {
      type: 'range', min: '0', max: '100', value: String(S.reverb), 'aria-label': 'Reverb',
      oninput: (e) => { S.reverb = clamp(Number(e.target.value) || 0, 0, 100); if (verbSend && ac) verbSend.gain.setTargetAtTime(S.reverb / 100 * 2, ac.currentTime, 0.03); saveSettings(); },
    });

    const bpmVal = h('span.piano__bpmval');
    const bpmSlider = h('input.slider.piano__bpm', {
      type: 'range', min: '40', max: '208', value: String(S.bpm),
      'aria-label': 'Metronome tempo',
      oninput: (e) => setBpm(Number(e.target.value)),
    });
    function setBpm(v) { S.bpm = clamp(Math.round(Number(v)) || 100, 40, 208); bpmVal.textContent = S.bpm + ' BPM'; bpmSlider.value = String(S.bpm); saveSettings(); }
    bpmVal.textContent = S.bpm + ' BPM';
    const btnMetro = h('button.ibtn.tip', { 'data-tip': 'Metronome', 'aria-label': 'Toggle metronome', onclick: () => setMetro(!S.metro) }, icon('activity'));
    const countSwitch = h('button.switch', { role: 'switch', 'aria-label': 'Count-in', 'aria-checked': String(S.countIn),
      onclick: () => { S.countIn = !S.countIn; countSwitch.classList.toggle('is-on', S.countIn); countSwitch.setAttribute('aria-checked', String(S.countIn)); saveSettings(); } });
    countSwitch.classList.toggle('is-on', S.countIn);

    /* ---- MIDI keyboard: off at every start; the browser is asked only when this is switched on ---- */
    const midiSwitch = h('button.switch', { role: 'switch', 'aria-label': 'MIDI keyboard', 'aria-checked': 'false', onclick: () => toggleMidi() });
    const midiStatus = h('span.piano__midistat', { role: 'status', 'aria-live': 'polite', text: describeMidi({ status: 'off', inputs: [] }) });
    const midiLast = h('span.piano__midilast.mono', { 'aria-label': 'Last MIDI note' });
    const midiPedal = h('span.piano__pedal', { text: 'Pedal', 'aria-hidden': 'true' });
    function setMidiPedal(down) { pedalDown = down; midiPedal.classList.toggle('is-on', down); settlePedal(); }
    function onMidiEvent(ev) {
      if (ev.type === 'on') {
        if (held.get(ev.note)?.has('midi')) release(ev.note, 'midi');   /* struck again: sound it afresh */
        press(ev.note, 'midi', undefined, ev.vel);
        midiLast.textContent = `${noteName(ev.note)} · velocity ${Math.round(ev.vel * 127)}`;
      } else if (ev.type === 'off') {
        release(ev.note, 'midi');
      } else if (ev.type === 'pedal') {
        setMidiPedal(ev.down);
      } else if (ev.type === 'allOff') {
        setMidiPedal(false);
        for (const [n, s] of [...held]) if (s.has('midi')) release(n, 'midi');
      }
    }
    const midi = createMidi({
      onEvent: onMidiEvent,
      onChange: st => {
        midiStatus.textContent = describeMidi(st);
        midiSwitch.classList.toggle('is-on', st.status === 'on' || st.status === 'asking');
        midiSwitch.setAttribute('aria-checked', String(st.status === 'on' || st.status === 'asking'));
        midiSwitch.dataset.state = st.status;
        if (st.status !== 'on') { setMidiPedal(false); for (const [n, s] of [...held]) if (s.has('midi')) release(n, 'midi'); }
      },
    });
    function toggleMidi() {
      const st = midi.state().status;
      if (st === 'on' || st === 'asking') midi.disable(); else midi.enable();
    }

    /* transport */
    const recDot = h('span.piano__recdot');
    const recLbl = h('span', { text: 'Record' });
    const btnRec = h('button.btn.btn--sm.piano__rec', { onclick: toggleRecord }, recDot, recLbl);
    const playLbl = h('span', { text: 'Play' });
    const btnPlay = h('button.btn.btn--sm', { onclick: playRecording }, icon('play'), playLbl);
    const btnExport = h('button.btn.btn--sm.tip', { 'data-tip': 'Render take to a WAV in Music', onclick: exportWav }, icon('save'), h('span', { text: 'Save' }));
    const btnClear = h('button.ibtn.tip', { 'data-tip': 'Clear take', 'aria-label': 'Clear recording', onclick: clearTake }, icon('trash'));
    const recTime = h('span.piano__rectime.mono');

    function updateTransport() {
      btnRec.classList.toggle('is-rec', rec.on);
      recLbl.textContent = rec.on || counting ? 'Stop' : 'Record';
      playLbl.textContent = playing ? 'Stop' : 'Play';
      btnPlay.replaceChildren(icon(playing ? 'square' : 'play'), playLbl);
      const n = countNotes();
      if (!counting) recTime.textContent = rec.on ? 'recording…' : (n ? n + ' note' + (n === 1 ? '' : 's') : 'no take');
      const empty = !rec.events.length;
      btnExport.disabled = empty || rec.on;
      btnClear.disabled = empty || rec.on;
      btnPlay.disabled = empty && !playing;
      if (typeof btnMidiOut !== 'undefined') btnMidiOut.disabled = empty || rec.on;
    }
    function countNotes() { return rec.events.filter(e => e.type === 'on').length; }

    function saveSettings() {
      store.set(K + '.settings', {
        voice: S.voice, octave: S.octave, volume: S.volume,
        sustain: S.sustain, bpm: S.bpm, help: S.help,
        reverb: S.reverb, scaleRoot: S.scaleRoot, scale: S.scale, countIn: S.countIn,
      });
    }

    /* ---- the drawer: Learn · Chords · Takes · MIDI files · Duet ---- */
    const msg = h('div.piano__msg', { role: 'status', 'aria-live': 'polite' });
    const say = t => { msg.textContent = t; };

    const tuneSel = h('select.select.piano__tune', { 'aria-label': 'Tune' }, TUNES.map(t => h('option', { value: t.id, text: t.title })));
    const tuneInfo = h('span.piano__tuneinfo', { text: `${TUNES[0].by}, ${TUNES[0].year}. In the public domain.` });
    tuneSel.addEventListener('change', () => { const t = TUNES.find(x => x.id === tuneSel.value); tuneInfo.textContent = `${t.by}, ${t.year}. In the public domain.`; if (learn.on) learnStart(t.id); });
    const learnBtn = h('button.btn.btn--sm.btn--primary', { type: 'button', 'aria-pressed': 'false', onclick: () => (learn.on ? learnStop() : learnStart(tuneSel.value)) }, 'Start learning');
    const hearBtn = h('button.btn.btn--sm', { type: 'button', onclick: hearTune }, icon('play'), h('span', { text: 'Hear it' }));
    const learnStat = h('div.piano__learnstat', { role: 'status', 'aria-live': 'polite' });
    const paneLearn = h('div.piano__pane', h('div.piano__row', tuneSel, learnBtn, hearBtn), tuneInfo, learnStat);

    const rootSel = h('select.select', { 'aria-label': 'Key', onchange: e => { S.scaleRoot = +e.target.value; paintScale(); saveSettings(); } },
      NAMES.map((n, i) => h('option', { value: String(i), text: n, selected: i === S.scaleRoot })));
    const scaleSel = h('select.select', { 'aria-label': 'Scale', onchange: e => { S.scale = e.target.value; paintScale(); saveSettings(); } },
      Object.entries(SCALES).map(([id, s]) => h('option', { value: id, text: s.label, selected: id === S.scale })));
    const paneChords = h('div.piano__pane',
      h('div.piano__row', h('label.piano__lab', h('span', { text: 'Key' }), rootSel), h('label.piano__lab', h('span', { text: 'Scale' }), scaleSel)),
      h('div.piano__row', Object.entries(CHORDS).map(([q, c]) => h('button.btn.btn--sm', { type: 'button', dataset: { chord: q }, 'aria-label': `Play ${c.label} chord`, onclick: () => playChord(q) }, h('span', { text: c.label })))),
      h('span.piano__tuneinfo', { text: 'The scale’s notes are marked on the keys (a ring on the first). The chord buttons play a chord on that key.' }));

    /* takes: up to ten, with names */
    const readTakes = () => (store.get(K + '.takes') || []).filter(t => t && typeof t.id === 'string' && Array.isArray(t.events)).slice(0, MAX_TAKES);
    const takeSel = h('select.select.piano__takesel', { 'aria-label': 'Saved takes' });
    const takeName = h('input.input.piano__takename', { type: 'text', maxlength: '32', placeholder: 'Name this take', 'aria-label': 'Take name', onkeydown: e => { e.stopPropagation(); if (e.key === 'Enter') keepTake(); } });
    function paintTakes() {
      const list = readTakes();
      takeSel.replaceChildren(...(list.length ? list.map(t => h('option', { value: t.id, text: `${t.name} (${t.events.filter(e => e.type === 'on').length} notes)` })) : [h('option', { value: '', text: 'No saved takes yet' })]));
      takeCount.textContent = `${list.length} of ${MAX_TAKES} saved`;
      loadTakeBtn.disabled = delTakeBtn.disabled = !list.length;
    }
    function keepTake() {
      const list = readTakes();
      if (!rec.events.length) { say('Record a take first.'); return; }
      const name = takeName.value.replace(/\s+/g, ' ').trim().slice(0, 32) || `Take ${list.length + 1}`;
      const same = list.find(t => t.name.toLowerCase() === name.toLowerCase());
      if (!same && list.length >= MAX_TAKES) { say(`You can keep ${MAX_TAKES} takes. Delete one first.`); return; }
      const entry = { id: same ? same.id : 't' + Date.now().toString(36), name, at: Date.now(), bpm: S.bpm, events: rec.events.slice(0, MAX_EVENTS) };
      store.set(K + '.takes', [entry, ...list.filter(t => t.id !== entry.id)]);
      takeName.value = ''; paintTakes(); takeSel.value = entry.id;
      say(`Kept “${name}”.`);
    }
    function loadTake() {
      const t = readTakes().find(x => x.id === takeSel.value);
      if (!t) return;
      if (playing) stopPlayback();
      rec.events = t.events.filter(e => e && (e.type === 'on' || e.type === 'off' || e.type === 'ped')).slice();
      store.set(K + '.take', rec.events.slice());
      if (t.bpm) setBpm(t.bpm);
      updateTransport();
      say(`Loaded “${t.name}”. Press Play.`);
    }
    function deleteTake() {
      const list = readTakes(), t = list.find(x => x.id === takeSel.value);
      if (!t) return;
      store.set(K + '.takes', list.filter(x => x.id !== t.id));
      paintTakes(); say(`Deleted “${t.name}”.`);
    }
    const loadTakeBtn = h('button.btn.btn--sm', { type: 'button', onclick: loadTake }, 'Load');
    const delTakeBtn = h('button.btn.btn--sm', { type: 'button', 'aria-label': 'Delete take', onclick: deleteTake }, icon('trash'));
    const takeCount = h('span.piano__tuneinfo');
    const paneTakes = h('div.piano__pane',
      h('div.piano__row', takeName, h('button.btn.btn--sm', { type: 'button', onclick: keepTake }, icon('save'), h('span', { text: 'Keep take' }))),
      h('div.piano__row', takeSel, loadTakeBtn, delTakeBtn), takeCount);

    /* MIDI files */
    const btnMidiOut = h('button.btn.btn--sm', { type: 'button', onclick: exportMidiFile }, icon('save'), h('span', { text: 'Save .mid' }));
    const chooseHost = h('div');
    const btnMidiIn = h('button.btn.btn--sm', { type: 'button', onclick: () => {
      chooseHost.replaceChildren(chooser({ h, icon, vfs: api.vfs, exts: ['mid', 'midi'], title: 'Choose a MIDI file from your Files',
        empty: 'No .mid files in your Files yet. Import one with Files › Import from computer.', onPick: f => { chooseHost.replaceChildren(); importMidiFile(f); }, onClose: () => chooseHost.replaceChildren() }));
    } }, icon('folder-open'), h('span', { text: 'Open .mid…' }));
    const paneMidi = h('div.piano__pane', h('div.piano__row', btnMidiOut, btnMidiIn),
      h('span.piano__tuneinfo', { text: 'Save .mid writes your take to Music. Open .mid loads a file from your own Files as the take; Play then shows its notes falling onto the keys.' }), chooseHost);

    /* duet */
    const duetBody = h('div.piano__pane.piano__duet');
    let duetNonce = 0;
    async function paintDuet() {
      const nonce = ++duetNonce;
      const body = duetBody;
      const items = [];
      if (!duet.room) {
        const input = h('input.input', { type: 'text', maxlength: '24', placeholder: 'Room code', 'aria-label': 'Room code', autocomplete: 'off', onkeydown: e => { e.stopPropagation(); if (e.key === 'Enter') go(); } });
        const go = () => { const c = normalizeCode(input.value); if (!isCode(c)) { duet.note = 'That isn’t a room code: it is six letters and numbers.'; paintDuet(); return; } duetOpen('guest', c); };
        items.push(h('p.piano__tuneinfo', { text: 'Play a duet on one keyboard. Start a room and send your friend the code, or type theirs. Only people you give the code to can join; treat it like a password.' }),
          h('div.piano__row', h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { duet: 'host' }, onclick: () => duetOpen('host') }, 'Start a room'), input, h('button.btn.btn--sm', { type: 'button', dataset: { duet: 'join' }, onclick: go }, 'Join')));
      } else {
        const code = duet.room.code;
        items.push(code ? h('div.piano__code', { dataset: { duet: 'code' }, 'aria-label': `Room code ${spaced(code)}`, text: code }) : null,
          h('p.piano__tuneinfo', { text: paired() ? `You are playing with ${duet.peer?.name || 'your friend'}. Their notes light up in a different colour.` : 'Waiting for your friend…' }),
          h('button.btn.btn--sm', { type: 'button', dataset: { duet: 'leave' }, onclick: () => { duetClose(); duet.note = ''; paintDuet(); } }, 'Leave the room'));
      }
      if (duet.note) items.push(h('p.piano__tuneinfo.piano__err', { role: 'status', text: duet.note }));
      items.push(h('p.piano__tuneinfo', { text: 'Runs over StaticOS’s live connection, a free public server: messages are sealed with the code, and a little delay is normal.' }));
      body.replaceChildren(...items.filter(Boolean));
      if (duet.room && duet.room.role === 'host' && !paired() && duet.room.code) {
        try { const p = await invitePanel({ h, icon, kind: 'piano', code: duet.room.code }); if (nonce === duetNonce && duet.room && !paired()) body.insertBefore(p, body.lastChild); } catch (e) { /* no friends */ }
      }
      roomStat.textContent = paired() ? `Duet with ${duet.peer?.name || 'a friend'}` : duet.room ? 'Waiting for a friend…' : '';
    }
    const roomStat = h('span.piano__tuneinfo.piano__roomstat', { role: 'status', 'aria-live': 'polite' });

    const TABS = [['learn', 'Learn', paneLearn], ['chords', 'Chords', paneChords], ['takes', 'Takes', paneTakes], ['midi', 'MIDI files', paneMidi], ['duet', 'Duet', duetBody]];
    const drawer = h('div.piano__drawer', { hidden: true });
    const tabBtns = new Map();
    let tab = '';
    function openTab(id) {
      tab = tab === id ? '' : id;
      for (const [k, b] of tabBtns) { b.classList.toggle('is-on', k === tab); b.setAttribute('aria-pressed', String(k === tab)); }
      drawer.hidden = !tab;
      drawer.replaceChildren(...TABS.filter(t => t[0] === tab).map(t => t[2]), msg);
      if (tab === 'duet') paintDuet();
    }
    const tabBar = h('div.piano__tabs', { role: 'group', 'aria-label': 'More to do' },
      TABS.map(([id, label]) => { const b = h('button.piano__segbtn', { type: 'button', dataset: { tab: id }, 'aria-pressed': 'false', onclick: () => openTab(id) }, label); tabBtns.set(id, b); return b; }), roomStat);

    /* ---- legend (key map) ---- */
    const legend = h('div.piano__legend');
    function renderLegend() {
      legend.replaceChildren(
        h('div.piano__legrow',
          h('span.piano__leglabel', { text: 'Keys' }),
          h('span.piano__legkeys', h('kbd', 'a'), h('kbd', 's'), h('kbd', 'd'), h('kbd', 'f'), h('kbd', 'g'), h('kbd', 'h'), h('kbd', 'j'), h('kbd', 'k'), h('span.piano__legtext', { text: 'white' })),
          h('span.piano__legkeys', h('kbd', 'w'), h('kbd', 'e'), h('kbd', 't'), h('kbd', 'y'), h('kbd', 'u'), h('kbd', 'o'), h('kbd', 'p'), h('span.piano__legtext', { text: 'black' })),
          h('span.piano__legkeys', h('kbd', 'z'), h('kbd', 'x'), h('span.piano__legtext', { text: 'octave' })),
        ),
      );
    }

    /* ---------------- layout ---------------- */
    const bar = h('div.app__bar.piano__bar',
      h('div.app__title', { text: 'Static Piano' }),
      h('div.grow'),
      h('div.piano__transport', recTime, btnRec, btnPlay, btnExport, btnClear),
    );

    const controls = h('div.piano__panel',
      h('div.piano__group',
        h('span.piano__glabel', { text: 'Voice' }),
        voiceSeg,
      ),
      h('div.piano__group',
        h('span.piano__glabel', { text: 'Octave' }),
        h('div.piano__oct', octMinus, octLabel, octPlus),
      ),
      h('div.piano__group',
        h('span.piano__glabel', { text: 'Sustain' }),
        sustainSwitch,
      ),
      h('div.piano__group.piano__group--wide',
        h('span.piano__glabel', { text: 'Volume' }),
        h('div.piano__slid', volIcon, volSlider),
      ),
      h('div.piano__group.piano__group--wide',
        h('span.piano__glabel', { text: 'Reverb' }),
        h('div.piano__slid', reverbSlider),
      ),
      h('div.piano__group.piano__group--wide',
        h('span.piano__glabel', { text: 'Tempo' }),
        h('div.piano__slid', btnMetro, bpmSlider, bpmVal),
      ),
      h('div.piano__group',
        h('span.piano__glabel', { text: 'Count-in' }),
        countSwitch,
      ),
      h('div.piano__group.piano__group--wide.piano__midi',
        h('span.piano__glabel', { text: 'MIDI keyboard' }),
        h('div.piano__slid', midiSwitch, midiLast, midiPedal),
        midiStatus,
      ),
    );

    const boardWrap = h('div.piano__board', renderBoard());
    const laneCv = h('canvas.piano__lanecv', { 'aria-hidden': 'true' });
    const laneEl = h('div.piano__lane', { hidden: true }, laneCv);
    const stage = h('div.piano__stage', laneEl, boardWrap, legend);

    /* an instrument: Settings › Sound's click sounds stay out of it */
    const appEl = h('div.app.app--col.piano', { 'data-sfx': 'off' }, bar, controls, tabBar, drawer, stage);
    if (reduced()) appEl.classList.add('is-reduced');
    root.appendChild(appEl);

    win.setTools(
      h('button.ibtn.tip', { 'data-tip': S.help ? 'Hide key map' : 'Show key map', 'aria-label': 'Toggle key map', onclick: (e) => toggleHelp(e.currentTarget) }, icon('keyboard')),
    );
    function toggleHelp(btn) {
      S.help = !S.help;
      legend.classList.toggle('is-hidden', !S.help);
      if (btn) btn.setAttribute('data-tip', S.help ? 'Hide key map' : 'Show key map');
      saveSettings();
    }

    updateOctLabel();
    setVoice(S.voice);
    paintVol();
    updateTransport();
    renderLegend();
    legend.classList.toggle('is-hidden', !S.help);
    paintScale(); paintTakes(); paintLearn();
    appEl.pianoPeek = () => ({ held: [...held.keys()], sus: [...sus], voices: voices.size, take: rec.events.length, learn: learn.j ? learn.j.stats() : null, octave: S.octave, bpm: S.bpm, sustain: S.sustain,
      room: duet.room ? { phase: duet.room.phase, code: duet.room.code, role: duet.room.role } : null, peerHeld: [...held].filter(([, s]) => s.has('peer')).map(([m]) => m) });
    appEl.pianoRoom = () => duet.room;                  /* play-tests only */
    const fromOpts = o => { if (o && o.join) { const c = normalizeCode(o.join).slice(0, 6); if (isCode(c)) { if (tab !== 'duet') openTab('duet'); duetOpen('guest', c); } } };
    if (win.onReopen) win.onReopen(fromOpts);
    fromOpts(ctx.opts);
    const onResize = () => { if (!laneEl.hidden) drawLane(); };
    window.addEventListener('resize', onResize);

    /* ---------------- pointer input (mouse + touch, with glissando) ---------------- */
    const pointers = new Map();        /* pointerId -> midi | null */
    function keyAt(x, y) { const el = document.elementFromPoint(x, y); return el ? el.closest('.pkey') : null; }

    const onPointerDown = (e) => {
      const k = e.target.closest && e.target.closest('.pkey');
      if (!k) return;
      e.preventDefault();
      const midi = +k.dataset.midi;
      pointers.set(e.pointerId, midi);
      press(midi, 'ptr:' + e.pointerId);
    };
    const onPointerMove = (e) => {
      if (!pointers.has(e.pointerId)) return;
      const cur = pointers.get(e.pointerId);
      const k = keyAt(e.clientX, e.clientY);
      const nm = k ? +k.dataset.midi : null;
      if (nm === cur) return;
      if (cur != null) release(cur, 'ptr:' + e.pointerId);
      pointers.set(e.pointerId, nm);
      if (nm != null) press(nm, 'ptr:' + e.pointerId);
    };
    const onPointerUp = (e) => {
      if (!pointers.has(e.pointerId)) return;
      const cur = pointers.get(e.pointerId);
      if (cur != null) release(cur, 'ptr:' + e.pointerId);
      pointers.delete(e.pointerId);
    };
    boardWrap.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);

    /* ---------------- computer keyboard ---------------- */
    const downKeys = new Set();
    function midiFor(key) {
      const off = KEYMAP[key];
      if (off === undefined) return null;
      return board.white[0].midi + off;
    }
    const onKeyDown = (e) => {
      if (!win.el.classList.contains('is-active')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const key = e.key.toLowerCase();
      if (key === 'z') { e.preventDefault(); if (!e.repeat) shiftOctave(-1); return; }
      if (key === 'x') { e.preventDefault(); if (!e.repeat) shiftOctave(1); return; }
      const midi = midiFor(key);
      if (midi == null) return;
      e.preventDefault();
      if (e.repeat || downKeys.has(key)) return;
      downKeys.add(key);
      press(midi, 'kbd:' + key);
    };
    const onKeyUp = (e) => {
      const key = e.key.toLowerCase();
      if (!downKeys.has(key)) return;
      downKeys.delete(key);
      const midi = midiFor(key);
      if (midi != null) release(midi, 'kbd:' + key);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    /* release everything (octave change, blur, teardown) */
    function allNotesOff() {
      for (const midi of [...held.keys()]) { held.get(midi).clear(); held.delete(midi); stopVoice(midi); }
      for (const n of [...sus]) { sus.delete(n); stopVoice(n); }
      for (const el of keyEls.values()) el.classList.remove('is-down', 'is-peer');
      downKeys.clear(); pointers.clear();
      pedalDown = false; midiPedal.classList.remove('is-on');
      if (paired()) { try { duet.room.send('ao', {}); } catch (e) {} duet.sent.clear(); }
      notePed();
    }
    const onBlur = () => allNotesOff();
    window.addEventListener('blur', onBlur);

    /* live loudness follows the OS */
    const unVol = store.sub('prefs.volume', () => { updateMaster(); paintVol(); });
    const unMute = store.sub('prefs.muted', () => { updateMaster(); paintVol(); });

    /* ---------------- teardown ---------------- */
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', onResize);
      boardWrap.removeEventListener('pointerdown', onPointerDown);
      unVol(); unMute();
      midi.disable();
      duetClose();
      cancelCount(); stopHear();
      if (laneRaf) cancelAnimationFrame(laneRaf);
      if (metroTimer) clearInterval(metroTimer);
      playTimers.forEach(clearTimeout); playTimers.clear();
      relTimers.forEach(clearTimeout); relTimers.clear();
      for (const [, v] of voices) {
        v.oscs.forEach(o => { try { o.stop(); } catch (e) {} try { o.disconnect(); } catch (e) {} });
        v.extra.forEach(n => { try { n.disconnect(); } catch (e) {} });
        try { v.out.disconnect(); } catch (e) {}
      }
      voices.clear(); held.clear(); sus.clear();
      if (ac) { try { ac.close(); } catch (e) {} ac = null; master = null; comp = null; }
    };
  },
});
