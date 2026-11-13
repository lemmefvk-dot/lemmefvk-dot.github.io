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
     frequency. Every voice feeds a shared master gain → soft
     compressor → the speakers.
   · Loudness is the OS's own prefs.volume / prefs.muted (read live)
     multiplied by this app's own volume knob, so muting the system
     really does mute the piano.
   · Sustain lengthens each note's release (a pedal, not a lie about
     infinite ring). Notes are reference-counted per source, so the
     mouse and the computer keyboard can hold the same key without
     one cutting the other off.
   · Record captures {time, note, on/off, voice}; Play replays that
     stream with real timers; Save to Music renders the take through
     an OfflineAudioContext to a genuine 16-bit WAV that opens in the
     Music and Files apps. The metronome uses an audio-clock look-ahead
     scheduler so its clicks don't drift.

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
import { createMidi, describe as describeMidi } from '../core/midi.js';

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

/* per-voice peak amplitude (square/tri read louder, so pull them down) */
const VOICES = {
  sine:     { label: 'Sine',     type: 'sine',     peak: 0.24 },
  triangle: { label: 'Triangle', type: 'triangle', peak: 0.20 },
  square:   { label: 'Square',   type: 'square',   peak: 0.13 },
  fm:       { label: 'FM Bell',  type: 'sine',     peak: 0.22, fm: { ratio: 2, index: 3, decay: 0.6 } },
};
const ENV = { a: 0.006, d: 0.30, s: 0.42, rShort: 0.16, rLong: 1.35 };

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
  keywords: ['piano', 'keyboard', 'synth', 'music', 'notes', 'instrument', 'record', 'octave', 'metronome'],
  desc: 'Play, record and replay a synthesised piano',
  singleton: true,
  win: { w: 760, h: 508, minW: 400, minH: 392 },
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
      metro: false,
      help: saved.help !== false,
    };
    let board = buildBoard((S.octave + 1) * 12);

    /* ---------------- audio ---------------- */
    let ac = null, master = null, comp = null;
    const voices = new Map();          /* midi -> { out, oscs, extra } */
    const held = new Map();            /* midi -> Set(source) */
    const relTimers = new Set();       /* release cleanup timers */
    const playTimers = new Set();      /* playback timers */
    let metroTimer = 0, metroNext = 0, metroBeat = 0;

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
      carrier.connect(out);
      oscs.push(carrier);
      return { out, oscs, extra, peak: V.peak };
    }

    function startVoice(midi, voiceName, vel) {
      const actx = ensureCtx();
      if (!actx || voices.has(midi)) return;
      const t = actx.currentTime;
      const v = makeVoice(actx, freqOf(midi), voiceName);
      v.out.gain.setValueAtTime(0.0001, t);
      const pk = v.peak * velScale(vel);
      v.out.gain.linearRampToValueAtTime(pk, t + ENV.a);
      v.out.gain.linearRampToValueAtTime(pk * ENV.s, t + ENV.a + ENV.d);
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

    /* ---------------- note routing (reference-counted per source) ---------------- */
    /* a key struck softly is quieter (mouse and keys have no velocity: full) */
    const velScale = v => (v == null ? 1 : 0.12 + 0.88 * clamp(v, 0, 1));
    function press(midi, source, voiceName, vel) {
      let s = held.get(midi);
      if (!s) { s = new Set(); held.set(midi, s); startVoice(midi, voiceName || S.voice, vel); }
      s.add(source);
      highlight(midi, true);
      if (rec.on && ac && source !== 'play') rec.events.push({ t: ac.currentTime - rec.start, midi, type: 'on', voice: voiceName || S.voice, ...(vel != null ? { vel } : {}) });
    }
    function release(midi, source) {
      const s = held.get(midi);
      if (!s) return;
      s.delete(source);
      if (s.size === 0) {
        held.delete(midi);
        stopVoice(midi);
        highlight(midi, false);
        if (rec.on && ac && source !== 'play') rec.events.push({ t: ac.currentTime - rec.start, midi, type: 'off' });
      }
    }
    /* a single keyboard/tap "click" with no matching release (a11y activation) */
    function pluck(midi) {
      press(midi, 'pluck');
      const id = setTimeout(() => { release(midi, 'pluck'); relTimers.delete(id); }, 380);
      relTimers.add(id);
    }

    /* ---------------- recording ---------------- */
    const rec = { on: false, start: 0, events: (store.get(K + '.take') || []).slice(), voiceAtStart: 'sine' };
    let playing = false;

    function toggleRecord() {
      if (playing) stopPlayback();
      if (rec.on) {
        rec.on = false;
        store.set(K + '.take', rec.events.slice());
        updateTransport();
        return;
      }
      ensureCtx();
      if (!ac) { notify({ app: 'Static Piano', icon: 'alert', title: 'No audio', message: 'This browser blocked the audio engine.' }); return; }
      rec.events = [];
      rec.start = ac.currentTime;
      rec.on = true;
      updateTransport();
    }
    function playRecording() {
      if (playing) { stopPlayback(); return; }
      if (rec.on) toggleRecord();
      if (!rec.events.length) { notify({ app: 'Static Piano', icon: 'info', title: 'Nothing recorded', message: 'Press Record, play some notes, then Play.' }); return; }
      if (!ensureCtx()) return;
      playing = true;
      updateTransport();
      for (const ev of rec.events) {
        const id = setTimeout(() => {
          playTimers.delete(id);
          if (ev.type === 'on') press(ev.midi, 'play', ev.voice, ev.vel);
          else release(ev.midi, 'play');
        }, Math.max(0, ev.t * 1000));
        playTimers.add(id);
      }
      const end = (rec.events[rec.events.length - 1].t + 0.4) * 1000;
      const doneId = setTimeout(() => stopPlayback(), end);
      playTimers.add(doneId);
    }
    function stopPlayback() {
      playTimers.forEach(clearTimeout); playTimers.clear();
      for (const [midi, s] of [...held]) if (s.has('play')) release(midi, 'play');
      playing = false;
      updateTransport();
    }
    function clearTake() {
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
    function setMetro(on) {
      S.metro = on;
      if (on) {
        if (!ensureCtx()) { S.metro = false; return; }
        metroBeat = 0; metroNext = ac.currentTime + 0.06;
        metroTick();
        metroTimer = setInterval(metroTick, 25);
      } else {
        clearInterval(metroTimer); metroTimer = 0;
      }
      if (btnMetro) btnMetro.classList.toggle('is-on', S.metro);
    }

    /* ---------------- WAV export via OfflineAudioContext ---------------- */
    function pairEvents(events) {
      const open = new Map(), out = [];
      for (const ev of events) {
        if (ev.type === 'on') open.set(ev.midi, { t: ev.t, voice: ev.voice, vel: ev.vel });
        else { const o = open.get(ev.midi); if (o) { out.push({ midi: ev.midi, on: o.t, off: ev.t, voice: o.voice, vel: o.vel }); open.delete(ev.midi); } }
      }
      for (const [midi, o] of open) out.push({ midi, on: o.t, off: o.t + 0.5, voice: o.voice, vel: o.vel });
      return out;
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
    async function exportWav() {
      if (rec.on) toggleRecord();
      if (!rec.events.length) { notify({ app: 'Static Piano', icon: 'info', title: 'Nothing to save', message: 'Record a take first.' }); return; }
      if (typeof OfflineAudioContext === 'undefined') { notify({ app: 'Static Piano', icon: 'alert', title: 'Not supported', message: 'This browser can\'t render offline audio.' }); return; }
      const pairs = pairEvents(rec.events);
      const dur = Math.max(...pairs.map(p => p.off)) + 2;
      const sr = 44100;
      btnExport.disabled = true;
      try {
        const off = new OfflineAudioContext(2, Math.ceil(dur * sr), sr);
        const m = off.createGain(); m.gain.value = 0.9;
        const cp = off.createDynamicsCompressor();
        cp.threshold.value = -12; cp.ratio.value = 4;
        m.connect(cp); cp.connect(off.destination);
        for (const p of pairs) {
          const v = makeVoice(off, freqOf(p.midi), p.voice || 'sine');
          const on = p.on, offT = Math.max(p.off, on + 0.05);
          const pk = v.peak * velScale(p.vel);
          v.out.gain.setValueAtTime(0.0001, on);
          v.out.gain.linearRampToValueAtTime(pk, on + ENV.a);
          v.out.gain.linearRampToValueAtTime(pk * ENV.s, on + ENV.a + ENV.d);
          v.out.gain.setTargetAtTime(0.0001, offT, ENV.rShort / 3);
          v.out.connect(m);
          v.oscs.forEach(o => { o.start(on); o.stop(offT + ENV.rShort + 0.1); });
        }
        const rendered = await off.startRendering();
        const blob = encodeWav(rendered);
        const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
        const { path } = await media.save(api.vfs.HOME + '/Music', `Piano take ${stamp}.wav`, blob);
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

    /* ---------------- UI ---------------- */
    const keyEls = new Map();          /* midi -> element */

    function highlight(midi, on) {
      const el = keyEls.get(midi);
      if (el) el.classList.toggle('is-down', on);
    }

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
    }

    const octLabel = h('span.piano__octval', { 'aria-live': 'polite' });
    const octMinus = h('button.ibtn.tip', { 'data-tip': 'Octave down (z)', 'aria-label': 'Octave down', onclick: () => shiftOctave(-1) }, icon('chevron-down'));
    const octPlus = h('button.ibtn.tip', { 'data-tip': 'Octave up (x)', 'aria-label': 'Octave up', onclick: () => shiftOctave(1) }, icon('chevron-up'));
    function shiftOctave(d) {
      const next = clamp(S.octave + d, 1, 6);
      if (next === S.octave) return;
      allNotesOff();
      S.octave = next;
      board = buildBoard((S.octave + 1) * 12);
      boardWrap.replaceChildren(renderBoard());
      updateOctLabel();
      saveSettings();
    }
    function updateOctLabel() { octLabel.textContent = noteName(board.white[0].midi) + '–' + noteName(board.lastMidi); }

    const sustainSwitch = h('button.switch', { role: 'switch', 'aria-label': 'Sustain', 'aria-checked': String(S.sustain), onclick: () => setSustain(!S.sustain) });
    sustainSwitch.classList.toggle('is-on', S.sustain);
    function setSustain(on) {
      S.sustain = on;
      sustainSwitch.classList.toggle('is-on', on);
      sustainSwitch.setAttribute('aria-checked', String(on));
      saveSettings();
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

    const bpmVal = h('span.piano__bpmval');
    const bpmSlider = h('input.slider.piano__bpm', {
      type: 'range', min: '40', max: '208', value: String(S.bpm),
      'aria-label': 'Metronome tempo',
      oninput: (e) => { S.bpm = clamp(Number(e.target.value) || 100, 40, 208); bpmVal.textContent = S.bpm + ' BPM'; saveSettings(); },
    });
    bpmVal.textContent = S.bpm + ' BPM';
    const btnMetro = h('button.ibtn.tip', { 'data-tip': 'Metronome', 'aria-label': 'Toggle metronome', onclick: () => setMetro(!S.metro) }, icon('activity'));

    /* ---- MIDI keyboard: off at every start; the browser is asked only when this is switched on ---- */
    const midiSwitch = h('button.switch', { role: 'switch', 'aria-label': 'MIDI keyboard', 'aria-checked': 'false', onclick: () => toggleMidi() });
    const midiStatus = h('span.piano__midistat', { role: 'status', 'aria-live': 'polite', text: describeMidi({ status: 'off', inputs: [] }) });
    const midiLast = h('span.piano__midilast.mono', { 'aria-label': 'Last MIDI note' });
    const pedalHeld = new Set();       /* notes let go of while the pedal was down */
    let pedalDown = false;
    function pedalUp() {
      pedalDown = false;
      for (const n of [...pedalHeld]) { pedalHeld.delete(n); release(n, 'midi'); }
      midiPedal.classList.remove('is-on');
    }
    const midiPedal = h('span.piano__pedal', { text: 'Pedal', 'aria-hidden': 'true' });
    function onMidiEvent(ev) {
      if (ev.type === 'on') {
        if (pedalHeld.delete(ev.note) || held.get(ev.note)?.has('midi')) release(ev.note, 'midi');   /* struck again: sound it afresh */
        press(ev.note, 'midi', undefined, ev.vel);
        midiLast.textContent = `${noteName(ev.note)} · velocity ${Math.round(ev.vel * 127)}`;
      } else if (ev.type === 'off') {
        if (pedalDown) pedalHeld.add(ev.note); else release(ev.note, 'midi');
      } else if (ev.type === 'pedal') {
        if (ev.down) { pedalDown = true; midiPedal.classList.add('is-on'); } else pedalUp();
      } else if (ev.type === 'allOff') {
        pedalUp();
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
        if (st.status !== 'on') { pedalUp(); for (const [n, s] of [...held]) if (s.has('midi')) release(n, 'midi'); }
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
      recLbl.textContent = rec.on ? 'Stop' : 'Record';
      playLbl.textContent = playing ? 'Stop' : 'Play';
      btnPlay.replaceChildren(icon(playing ? 'square' : 'play'), playLbl);
      const n = countNotes();
      recTime.textContent = rec.on ? 'recording…' : (n ? n + ' note' + (n === 1 ? '' : 's') : 'no take');
      const empty = !rec.events.length;
      btnExport.disabled = empty || rec.on;
      btnClear.disabled = empty || rec.on;
      btnPlay.disabled = empty && !playing;
    }
    function countNotes() { return rec.events.filter(e => e.type === 'on').length; }

    function saveSettings() {
      store.set(K + '.settings', {
        voice: S.voice, octave: S.octave, volume: S.volume,
        sustain: S.sustain, bpm: S.bpm, help: S.help,
      });
    }

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
        h('span.piano__glabel', { text: 'Tempo' }),
        h('div.piano__slid', btnMetro, bpmSlider, bpmVal),
      ),
      h('div.piano__group.piano__group--wide.piano__midi',
        h('span.piano__glabel', { text: 'MIDI keyboard' }),
        h('div.piano__slid', midiSwitch, midiLast, midiPedal),
        midiStatus,
      ),
    );

    const boardWrap = h('div.piano__board', renderBoard());
    const stage = h('div.piano__stage', boardWrap, legend);

    /* an instrument: Settings › Sound's click sounds stay out of it */
    const appEl = h('div.app.app--col.piano', { 'data-sfx': 'off' }, bar, controls, stage);
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
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
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
      for (const midi of [...held.keys()]) { held.get(midi).clear(); held.delete(midi); stopVoice(midi); highlight(midi, false); }
      downKeys.clear(); pointers.clear();
      pedalHeld.clear(); pedalDown = false; midiPedal.classList.remove('is-on');
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
      boardWrap.removeEventListener('pointerdown', onPointerDown);
      unVol(); unMute();
      midi.disable();
      if (metroTimer) clearInterval(metroTimer);
      playTimers.forEach(clearTimeout); playTimers.clear();
      relTimers.forEach(clearTimeout); relTimers.clear();
      for (const [, v] of voices) {
        v.oscs.forEach(o => { try { o.stop(); } catch (e) {} try { o.disconnect(); } catch (e) {} });
        v.extra.forEach(n => { try { n.disconnect(); } catch (e) {} });
        try { v.out.disconnect(); } catch (e) {}
      }
      voices.clear(); held.clear();
      if (ac) { try { ac.close(); } catch (e) {} ac = null; master = null; comp = null; }
    };
  },
});
