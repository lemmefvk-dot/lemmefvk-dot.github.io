/* ============================================================
   synth.js — Static Synth

   A playable WebAudio synthesizer. The sound engine is js/core/synth.js
   (oscillators, envelope, filter, LFO, delay, reverb, chorus, glide, pitch
   bend, voice limit, limiter); this file is the panel and the inputs:
   on-screen keys, the computer keyboard (a·w·s·e·d…, z / x for octaves)
   and MIDI (js/core/midi.js, asked for only when its switch is turned on,
   pitch wheel included). All of them call the same noteOn / noteOff, so
   they behave identically.

   Playing: Hold latches the sustain pedal; Glide slides between notes;
   the pitch-bend slider springs back to the middle (and a MIDI wheel moves
   it). The arpeggiator turns the notes you hold into a pattern (up, down,
   up and down, random, as played; one to four octaves; 1/4, 1/8 or 1/16
   notes) on the tempo slider, and the 16-step sequencer plays a line of
   notes you set, both on one look-ahead clock read from the audio
   context. The oscilloscope draws what is really leaving the synth (an
   AnalyserNode on the output), so it is flat when nothing sounds.

   Record keeps the notes (arpeggiator and sequencer included) and Hold,
   with the sound the take started with; Save take renders it through an
   OfflineAudioContext to a 16-bit WAV in ~/Music. Pitch bend is not in
   the take, and the page says so.

   Presets: eight factory sounds plus your own ("Save as"), kept in the
   app's saved state. Randomise makes a new sound inside every range.
   Export writes a .staticsynth file (plain JSON) into ~/Documents to send
   to a friend; Import reads one from your own Files and treats it as
   untrusted: every number is clamped, unknown things are dropped.
   Close, blur or tab-hide lets go of every note, and closing stops the
   oscillators and closes the AudioContext.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { createSynth, cleanPatch, PRESETS, RANGES, KEYMAP, arpSequence, arpPick, randomPatch, ARP_MODES } from '../core/synth.js';
import { createMidi, describe as describeMidi } from '../core/midi.js';
import { encodeWav } from '../core/wavedit.js';
import media from '../core/media.js';
import { chooser } from '../core/filechoose.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-piano-css')) {
  const l = document.createElement('link');
  l.id = 'feat-piano-css'; l.rel = 'stylesheet'; l.href = 'css/feat-piano.css';
  document.head.appendChild(l);
}
if (typeof document !== 'undefined' && !document.getElementById('feat-audioplus-css')) {
  const l = document.createElement('link');
  l.id = 'feat-audioplus-css'; l.rel = 'stylesheet'; l.href = 'css/feat-audioplus.css';
  document.head.appendChild(l);
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const isBlack = m => NAMES[((m % 12) + 12) % 12].includes('#');
const noteName = m => NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const LOG = new Set(['cutoff', 'a', 'd', 'r', 'fdecay', 'lfoRate', 'delayTime']);
const WAVE_OPTS = [['sine', 'Sine'], ['triangle', 'Triangle'], ['sawtooth', 'Saw'], ['square', 'Square']];
const unit = { cutoff: v => (v >= 1000 ? (v / 1000).toFixed(1) + ' kHz' : Math.round(v) + ' Hz'), a: s, d: s, r: s, fdecay: s, delayTime: s, glide: s, lfoRate: v => v.toFixed(1) + ' Hz', lfoPitch: v => Math.round(v) + ' ct', lfoFilter: v => Math.round(v) + ' ct', o2detune: v => Math.round(v) + ' ct', o1oct: o, o2oct: o };
function s(v) { return v < 1 ? Math.round(v * 1000) + ' ms' : v.toFixed(2) + ' s'; }
function o(v) { return (v > 0 ? '+' : '') + v; }
const PERCENT = new Set(['s', 'o2level', 'volume', 'delayFb', 'reverbMix', 'chorusMix']);
const fmtVal = (k, v) => (unit[k] ? unit[k](v) : (PERCENT.has(k) || k.startsWith('delayMix')) ? Math.round(v * 100) + '%' : Number(v).toFixed(1));
const RATES = [[1, '1/4 notes'], [2, '1/8 notes'], [4, '1/16 notes']];
const SEQ_LO = 36, SEQ_HI = 83;
const FORMAT = 'staticos-synth-preset';

defineApp({
  id: 'synth',
  name: 'Static Synth',
  icon: 'sliders',
  g1: '#9a7dff', g2: '#4d27cf',
  category: 'Media',
  keywords: ['synth', 'synthesizer', 'synthesiser', 'oscillator', 'filter', 'envelope', 'preset', 'keyboard', 'midi', 'music', 'instrument', 'delay', 'lfo', 'arpeggiator', 'arp', 'sequencer', 'reverb', 'chorus', 'scope', 'record'],
  desc: 'Play a synthesizer with presets, an arpeggiator and a sequencer',
  singleton: true,
  win: { w: 900, h: 720, minW: 440, minH: 460 },
  shortcuts: [
    ['A / W / S / E / D / F / T / G / Y / H / U / J / K', 'Play the notes (the letters are printed on the keys)'],
    ['Z / X', 'Octave down / up'],
  ],

  mount(ctx) {
    const { root, win, api } = ctx;
    const { h, icon, store, notify } = api;
    const K = 'portal.synth';
    const saved = store.get(K) || {};
    const userPresets = () => (store.get(K + '.user') || []).filter(p => p && typeof p.name === 'string').map(p => ({ id: String(p.id), name: p.name.slice(0, 40), p: cleanPatch(p.p) }));

    const S = {
      patch: cleanPatch(saved.cur || PRESETS[0].p),
      presetId: typeof saved.presetId === 'string' ? saved.presetId : PRESETS[0].id,
      octave: clamp(Number.isFinite(saved.octave) ? saved.octave : 3, 1, 6),
      maxVoices: clamp(Number.isFinite(saved.maxVoices) ? saved.maxVoices : 8, 1, 16),
      bpm: clamp(Number.isFinite(saved.bpm) ? saved.bpm : 110, 40, 240),
      hold: false,
    };
    const persist = () => store.set(K, { ...(store.get(K) || {}), cur: S.patch, presetId: S.presetId, octave: S.octave, maxVoices: S.maxVoices, bpm: S.bpm });

    /* ---------- audio ---------- */
    let ac = null, syn = null, an = null, scopeBuf = null, midiPedal = false;
    const AC = window.AudioContext || window.webkitAudioContext;
    function engine() {
      if (syn) { if (ac.state === 'suspended') ac.resume().catch(() => {}); return syn; }
      if (!AC) { err.textContent = 'This browser has no Web Audio, so the synth cannot make sound.'; return null; }
      try { ac = new AC(); } catch (e) { err.textContent = 'The audio engine could not start.'; return null; }
      syn = createSynth(ac, { patch: S.patch, maxVoices: S.maxVoices });
      an = ac.createAnalyser(); an.fftSize = 1024; scopeBuf = new Uint8Array(an.fftSize);
      syn.out.connect(an);                                  /* the scope only listens; it adds no sound */
      if (S.hold) syn.sustain(true);
      ac.resume().catch(() => {});
      startRaf();
      return syn;
    }
    /* every note the synth is asked for goes through here, so a take hears them all */
    function trigOn(note, vel, src, when) {
      const e = engine(); if (!e) return;
      e.noteOn(note, vel, src, when);
      recNote(note, vel, true, when);
    }
    function trigOff(note, src, when) { if (!syn) return; syn.noteOff(note, src, when); recNote(note, 0, false, when); }
    const on = (note, vel, src) => {
      if (arp.on) { arpPress(note, src); mark(note, true); return; }
      trigOn(note, vel, src); mark(note, true);
    };
    const off = (note, src) => {
      if (arp.on) { arpRelease(note, src); if (!arp.srcs.has(note)) mark(note, false); return; }
      if (syn) { trigOff(note, src); if (!syn.held().includes(note) && !syn.sustained().includes(note)) mark(note, false); }
    };
    function allOff() {
      if (syn) syn.allNotesOff();
      arp.srcs.clear(); if (!S.hold) arp.list = [];
      keyEls.forEach(el => el.classList.remove('is-down'));
      downKeys.clear(); pointers.clear();
      padLit.classList.remove('is-on'); midiPedal = false;
      applyPedal();
    }
    function applyPedal() { const d = S.hold || midiPedal; if (syn) syn.sustain(d); recSus(d); }

    /* ---------- patch controls ---------- */
    const ctl = new Map();           /* key -> { input, out } */
    function applyPatch(p, id) {
      S.patch = cleanPatch(p);
      S.presetId = id || '';
      if (syn) syn.setPatch(S.patch);
      for (const [k, c] of ctl) paintCtl(k, c);
      paintPreset();
      persist();
    }
    function edit(k, v) {
      S.patch = cleanPatch({ ...S.patch, [k]: v });
      if (syn) syn.setPatch(S.patch);
      S.presetId = '';
      paintCtl(k, ctl.get(k)); paintPreset(); persist();
    }
    const toPos = (k, v) => { const [lo, hi] = RANGES[k]; return LOG.has(k) ? Math.round(1000 * Math.log(v / lo) / Math.log(hi / lo)) : Math.round(1000 * (v - lo) / (hi - lo)); };
    const fromPos = (k, p) => { const [lo, hi] = RANGES[k]; return LOG.has(k) ? lo * Math.pow(hi / lo, p / 1000) : lo + (hi - lo) * p / 1000; };
    function paintCtl(k, c) {
      if (!c) return;
      if (c.sel) c.input.value = String(S.patch[k]);
      else { c.input.value = String(toPos(k, S.patch[k])); c.out.textContent = fmtVal(k, S.patch[k]); c.input.setAttribute('aria-valuetext', c.out.textContent); }
    }
    function slider(k, label) {
      const input = h('input.slider', { type: 'range', min: '0', max: '1000', step: '1', 'aria-label': label, dataset: { key: k },
        oninput: e => edit(k, k.endsWith('oct') ? Math.round(fromPos(k, +e.target.value)) : fromPos(k, +e.target.value)) });
      if (k.endsWith('oct')) { input.min = String(RANGES[k][0]); input.max = String(RANGES[k][1]); }
      const out = h('span.synth__val.mono');
      const c = { input, out };
      if (k.endsWith('oct')) { input.oninput = e => edit(k, +e.target.value); c.paint = true; }
      ctl.set(k, c);
      return h('label.synth__ctl', h('span.synth__lbl', { text: label }), input, out);
    }
    function select(k, label, opts) {
      const input = h('select.synth__sel', { 'aria-label': label, dataset: { key: k }, onchange: e => edit(k, e.target.value) },
        ...opts.map(([v, t]) => h('option', { value: v, text: t })));
      ctl.set(k, { input, sel: true });
      return h('label.synth__ctl', h('span.synth__lbl', { text: label }), input);
    }
    /* octave sliders hold the number itself */
    const origPaint = paintCtl;
    paintCtl = function (k, c) {
      if (c && !c.sel && k.endsWith('oct')) { c.input.value = String(S.patch[k]); c.out.textContent = unit[k](S.patch[k]); return; }
      origPaint(k, c);
    };

    /* the oscilloscope: what is really leaving the synth */
    const scopeCv = h('canvas.synth__scope', { width: 240, height: 70, role: 'img', 'aria-label': 'Oscilloscope: the shape of the sound leaving the synth' });
    let raf = 0;
    function drawScope() {
      const g = scopeCv.getContext('2d'), W = scopeCv.width, H = scopeCv.height;
      g.clearRect(0, 0, W, H);
      const css = getComputedStyle(scopeCv);
      g.strokeStyle = css.getPropertyValue('--line-2').trim() || '#555'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
      g.strokeStyle = css.getPropertyValue('--accent').trim() || '#9a7dff'; g.lineWidth = 2;
      g.beginPath();
      if (an) {
        an.getByteTimeDomainData(scopeBuf);
        let lo = 0;                                           /* start on a rising crossing so a steady note holds still */
        for (let i = 1; i < scopeBuf.length / 2; i++) if (scopeBuf[i - 1] < 128 && scopeBuf[i] >= 128) { lo = i; break; }
        const n = Math.min(512, scopeBuf.length - lo);
        for (let i = 0; i < n; i++) { const x = i / (n - 1) * W, y = clamp(H / 2 - ((scopeBuf[lo + i] - 128) / 128) * (H / 2) * 3, 1, H - 1); i ? g.lineTo(x, y) : g.moveTo(x, y); }   /* drawn three times larger, as a scope's volts-per-division knob would */
      } else { g.moveTo(0, H / 2); g.lineTo(W, H / 2); }
      g.stroke();
    }
    function startRaf() {
      if (raf) return;
      const f = () => { drawScope(); paintSeqHead(); raf = document.hidden ? 0 : requestAnimationFrame(f); };
      raf = requestAnimationFrame(f);
    }

    const sec = (title, ...kids) => h('section.synth__sec', h('h3.synth__h', { text: title }), ...kids);
    const panel = h('div.synth__panel',
      sec('Oscillator 1', select('o1wave', 'Wave 1', WAVE_OPTS), slider('o1oct', 'Octave 1')),
      sec('Oscillator 2', select('o2wave', 'Wave 2', WAVE_OPTS), slider('o2level', 'Level 2'), slider('o2oct', 'Octave 2'), slider('o2detune', 'Detune 2')),
      sec('Envelope', slider('a', 'Attack'), slider('d', 'Decay'), slider('s', 'Sustain'), slider('r', 'Release')),
      sec('Filter', select('filter', 'Filter type', [['lowpass', 'Low-pass'], ['highpass', 'High-pass'], ['bandpass', 'Band-pass']]), slider('cutoff', 'Cutoff'), slider('res', 'Resonance'), slider('fenv', 'Filter envelope'), slider('fdecay', 'Filter decay')),
      sec('Modulation', select('lfoWave', 'LFO wave', WAVE_OPTS), slider('lfoRate', 'LFO rate'), slider('lfoPitch', 'Vibrato'), slider('lfoFilter', 'Filter wobble')),
      sec('Delay', slider('delayTime', 'Delay time'), slider('delayFb', 'Feedback'), slider('delayMix', 'Delay mix')),
      sec('Space', slider('reverbMix', 'Reverb'), slider('chorusMix', 'Chorus')),
      sec('Glide', slider('glide', 'Glide time')),
      sec('Scope', scopeCv),
    );

    /* ---------- presets ---------- */
    const presetSel = h('select.synth__sel.synth__preset', { 'aria-label': 'Preset', onchange: e => {
      const id = e.target.value;
      const p = PRESETS.find(x => x.id === id) || userPresets().find(x => x.id === id);
      if (p) applyPatch(p.p, p.id);
    } });
    function paintPreset() {
      const mine = userPresets();
      presetSel.replaceChildren(
        S.presetId ? null : h('option', { value: '', text: 'Custom (edited)', disabled: true }),
        h('optgroup', { label: 'Factory' }, ...PRESETS.map(p => h('option', { value: p.id, text: p.name }))),
        mine.length ? h('optgroup', { label: 'Yours' }, ...mine.map(p => h('option', { value: p.id, text: p.name }))) : null,
      );
      presetSel.value = S.presetId;
      btnDel.disabled = !mine.some(p => p.id === S.presetId);
    }
    const nameIn = h('input.synth__name', { type: 'text', maxlength: '40', placeholder: 'Name your preset', 'aria-label': 'Preset name',
      onkeydown: e => { e.stopPropagation(); if (e.key === 'Enter') doSave(); if (e.key === 'Escape') nameRow.hidden = true; } });
    const nameRow = h('span.synth__namerow', { hidden: true }, nameIn, h('button.btn.btn--sm.btn--primary', { type: 'button', text: 'Save', onclick: () => doSave() }));
    /* keep a preset of the user's own; returns its id, or null when full */
    function keepPreset(name, patch) {
      name = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (!name) return null;
      if (PRESETS.some(p => p.name.toLowerCase() === name.toLowerCase())) name += ' (mine)';
      const mine = userPresets();
      const same = mine.find(p => p.name.toLowerCase() === name.toLowerCase());
      if (!same && mine.length >= 40) { err.textContent = 'You can keep up to 40 presets. Delete one first.'; return null; }
      const id = same ? same.id : 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      store.set(K + '.user', [...mine.filter(p => p.id !== id), { id, name, p: cleanPatch(patch) }]);
      return id;
    }
    function doSave() {
      if (!nameIn.value.trim()) { nameIn.focus(); return; }
      const id = keepPreset(nameIn.value, S.patch);
      if (!id) return;
      S.presetId = id; nameRow.hidden = true; nameIn.value = ''; err.textContent = '';
      paintPreset(); persist();
    }
    const btnSave = h('button.btn.btn--sm', { type: 'button', onclick: () => { nameRow.hidden = !nameRow.hidden; if (!nameRow.hidden) nameIn.focus(); } }, icon('save'), h('span', { text: 'Save as…' }));
    const btnDel = h('button.btn.btn--sm', { type: 'button', 'aria-label': 'Delete preset', onclick: () => {
      store.set(K + '.user', userPresets().filter(p => p.id !== S.presetId));
      applyPatch(PRESETS[0].p, PRESETS[0].id);
    } }, icon('trash'));
    const btnRand = h('button.btn.btn--sm', { type: 'button', 'aria-label': 'Randomise the sound', onclick: () => { applyPatch(randomPatch(Math.random, { volume: S.patch.volume }), ''); err.textContent = ''; } }, icon('shuffle'), h('span', { text: 'Random' }));

    /* preset files */
    const fileHost = h('div.synth__files');
    function presetName() { const p = PRESETS.find(x => x.id === S.presetId) || userPresets().find(x => x.id === S.presetId); return p ? p.name : 'My sound'; }
    async function exportPreset() {
      try {
        const name = presetName();
        const body = JSON.stringify({ app: FORMAT, v: 1, name, patch: S.patch }, null, 1);
        const { path } = await media.save(api.vfs.HOME + '/Documents/Synth presets', `${name.replace(/[^\w .-]+/g, '').trim() || 'My sound'}.staticsynth`, new Blob([body], { type: 'application/json' }));
        notify({ app: 'Static Synth', icon: 'save', title: 'Preset file saved', message: `${api.vfs.baseName(path)} is in Documents › Synth presets. Send it to a friend with Static Drop; they import it here.`,
          actions: api.getApp?.('drop') ? [{ label: 'Open Static Drop', onClick: () => api.openApp('drop') }] : undefined, timeout: 8000 });
        err.textContent = '';
        return path;
      } catch (e) { err.textContent = 'Could not save the preset file: ' + String(e && e.message || e); return null; }
    }
    async function importPreset(file) {
      try {
        const blob = await media.blobOf(file.path);
        if (!blob || blob.size > 20000) { err.textContent = `${file.name} is not a synth preset (too big or empty).`; return; }
        let o; try { o = JSON.parse(await blob.text()); } catch (e) { o = null; }
        if (!o || o.app !== FORMAT || !o.patch || typeof o.patch !== 'object') { err.textContent = `${file.name} is not a Static Synth preset file.`; return; }
        const id = keepPreset(String(o.name || file.name.replace(/\.[^.]+$/, '')), o.patch);
        if (!id) return;
        applyPatch(userPresets().find(p => p.id === id).p, id);
        err.textContent = '';
        notify({ app: 'Static Synth', icon: 'check-circle', title: 'Preset imported', message: `“${presetName()}” is in your presets.`, timeout: 4000 });
      } catch (e) { err.textContent = 'Could not read that file: ' + String(e && e.message || e); }
    }
    const btnExp = h('button.btn.btn--sm', { type: 'button', 'aria-label': 'Export preset file', onclick: exportPreset }, icon('download'), h('span', { text: 'Export' }));
    const btnImp = h('button.btn.btn--sm', { type: 'button', 'aria-label': 'Import preset file', onclick: () => {
      fileHost.replaceChildren(chooser({ h, icon, vfs: api.vfs, exts: ['staticsynth'], title: 'Choose a preset file from your Files',
        empty: 'No .staticsynth files in your Files yet. A friend can send you one; save it in Files first.', onPick: f => { fileHost.replaceChildren(); importPreset(f); }, onClose: () => fileHost.replaceChildren() }));
    } }, icon('upload'), h('span', { text: 'Import' }));

    /* ---------- voices, volume ---------- */
    const voiceOut = h('span.synth__voices.mono', { 'aria-live': 'off' });
    const voiceSlider = h('input.slider', { type: 'range', min: '1', max: '16', step: '1', value: String(S.maxVoices), 'aria-label': 'Voice limit',
      oninput: e => { S.maxVoices = +e.target.value; if (syn) syn.setMaxVoices(S.maxVoices); paintVoices(); persist(); } });
    function paintVoices() { voiceOut.textContent = `Voices ${syn ? syn.voices() : 0} / ${S.maxVoices}`; }
    ctl.set('volume', { input: null });
    const volSlider = h('input.slider', { type: 'range', min: '0', max: '1000', 'aria-label': 'Synth volume', dataset: { key: 'volume' },
      oninput: e => edit('volume', +e.target.value / 1000) });
    ctl.set('volume', { input: volSlider, out: h('span'), paint: true });
    ctl.get('volume').out = { set textContent(v) {} };
    const err = h('div.synth__err', { role: 'status', 'aria-live': 'polite' });

    /* ---------- keyboard ---------- */
    const keyEls = new Map();
    const mark = (n, d) => { const el = keyEls.get(n); if (el) el.classList.toggle('is-down', d); };
    const base = () => (S.octave + 1) * 12;
    function board() {
      keyEls.clear();
      const whites = h('div.piano__whites'), blacks = h('div.piano__blacks');
      const list = []; let m = base(), wi = 0;
      while (list.filter(x => !x.b).length < 15) { list.push({ m, b: isBlack(m), wi }); if (!isBlack(m)) wi++; m++; }
      const total = 15;
      const letterFor = {}; for (const [k, off] of Object.entries(KEYMAP)) if (letterFor[off] === undefined) letterFor[off] = k;
      for (const k of list) {
        const letter = letterFor[k.m - base()];
        const el = h('button.pkey.' + (k.b ? 'pkey--black' : 'pkey--white'), { type: 'button', dataset: { midi: k.m }, 'aria-label': noteName(k.m),
          style: k.b ? { left: ((k.wi / total) * 100) + '%', width: ((100 / total) * 0.62) + '%' } : null,
          onclick: e => { if (e.detail === 0) { on(k.m, 1, 'click'); setTimeout(() => off(k.m, 'click'), 350); } } },
          letter ? h('span.pkey__key', { text: letter }) : null, k.b ? null : h('span.pkey__name', { text: noteName(k.m) }));
        keyEls.set(k.m, el);
        (k.b ? blacks : whites).appendChild(el);
      }
      return h('div.piano__keys', { style: { minWidth: '510px' } }, whites, blacks);
    }
    const boardWrap = h('div.piano__board', board());
    const octLabel = h('span.piano__octval', { 'aria-live': 'polite' });
    function shiftOct(d) {
      const n = clamp(S.octave + d, 1, 6);
      if (n === S.octave) return;
      allOff(); S.octave = n; boardWrap.replaceChildren(board()); paintOct(); persist();
    }
    const paintOct = () => { octLabel.textContent = noteName(base()) + '–' + noteName(base() + 24); };

    /* ---------- hold, pitch bend ---------- */
    const holdSwitch = h('button.switch', { role: 'switch', 'aria-label': 'Hold', 'aria-checked': 'false', onclick: () => {
      S.hold = !S.hold;
      holdSwitch.classList.toggle('is-on', S.hold); holdSwitch.setAttribute('aria-checked', String(S.hold));
      applyPedal();
      if (!S.hold && arp.on && !arp.srcs.size) arp.list = [];
    } });
    const bendSlider = h('input.slider.synth__bend', { type: 'range', min: '-100', max: '100', step: '1', value: '0', 'aria-label': 'Pitch bend',
      oninput: e => { if (syn) syn.bend(+e.target.value / 100); },
      onpointerup: () => springBend(), onpointercancel: () => springBend(), onkeyup: () => springBend(), onblur: () => springBend() });
    function springBend() { bendSlider.value = '0'; if (syn) syn.bend(0); }
    function bendTo(v) { bendSlider.value = String(Math.round(v * 100)); if (syn) syn.bend(v); }

    /* ---------- MIDI ---------- */
    const midiSwitch = h('button.switch', { role: 'switch', 'aria-label': 'MIDI keyboard', 'aria-checked': 'false', onclick: () => {
      const st = midi.state().status;
      if (st === 'on' || st === 'asking') midi.disable(); else midi.enable();
    } });
    const midiStatus = h('span.piano__midistat', { role: 'status', 'aria-live': 'polite', text: describeMidi({ status: 'off', inputs: [] }) });
    const midiLast = h('span.piano__midilast.mono', { 'aria-label': 'Last MIDI note' });
    const padLit = h('span.piano__pedal', { text: 'Pedal', 'aria-hidden': 'true' });
    const midi = createMidi({
      onEvent: ev => {
        if (ev.type === 'on') { on(ev.note, ev.vel, ev.src); midiLast.textContent = `${noteName(ev.note)} · velocity ${Math.round(ev.vel * 127)}`; }
        else if (ev.type === 'off') off(ev.note, ev.src);
        else if (ev.type === 'bend') bendTo(ev.value);
        else if (ev.type === 'pedal') {
          padLit.classList.toggle('is-on', ev.down);
          midiPedal = ev.down; applyPedal();
          if (syn && !ev.down) keyEls.forEach((el, n) => { if (!syn.held().includes(n) && !syn.sustained().includes(n)) el.classList.remove('is-down'); });
        } else if (ev.type === 'allOff') allOff();
      },
      onChange: st => {
        midiStatus.textContent = describeMidi(st);
        const onn = st.status === 'on' || st.status === 'asking';
        midiSwitch.classList.toggle('is-on', onn); midiSwitch.setAttribute('aria-checked', String(onn)); midiSwitch.dataset.state = st.status;
      },
    });

    /* ---------- the clock: arpeggiator and sequencer ---------- */
    const arp = { on: false, mode: 'up', rate: 2, oct: 1, gate: 0.6, list: [], srcs: new Map(), i: 0, next: 0, playing: new Set() };
    const readSeq = () => {
      const raw = Array.isArray(store.get(K + '.seq')) ? store.get(K + '.seq') : [];
      return Array.from({ length: 16 }, (_, i) => ({ on: !!raw[i]?.on, note: clamp(Math.round(Number(raw[i]?.note)) || (i % 4 === 0 ? 48 : 52), SEQ_LO, SEQ_HI) }));
    };
    const seq = { on: false, steps: readSeq(), pos: 0, next: 0, queue: [], head: -1 };
    let clockT = 0;
    function arpPress(note, src) {
      if (arp.fresh) { arp.list = []; arp.fresh = false; }
      if (!arp.srcs.has(note)) arp.srcs.set(note, new Set());
      arp.srcs.get(note).add(src);
      if (!arp.list.includes(note)) arp.list.push(note);
    }
    function arpRelease(note, src) {
      const s = arp.srcs.get(note);
      if (s) { s.delete(src); if (!s.size) arp.srcs.delete(note); }
      if (!arp.srcs.has(note) && !S.hold) arp.list = arp.list.filter(n => n !== note);
      if (S.hold && !arp.srcs.size) arp.fresh = true;           /* the next chord replaces the held one */
    }
    function clockTick() {
      if (!syn || !ac) return;
      const spb = 60 / S.bpm, now = ac.currentTime;
      if (arp.on) while (arp.next < now + 0.12) {
        const order = arpSequence(arp.list, arp.mode, arp.oct);
        if (order.length) {
          const n = arpPick(order, arp.i, arp.mode), dur = spb / arp.rate;
          trigOn(n, 0.9, 'arp', arp.next);
          trigOff(n, 'arp', arp.next + dur * arp.gate);
          arp.playing.add(n); arp.i++;
        }
        arp.next += spb / arp.rate;
      }
      if (seq.on) while (seq.next < now + 0.12) {
        const st = seq.steps[seq.pos], dur = spb / 4;
        if (st.on) { trigOn(st.note, 0.9, 'seq', seq.next); trigOff(st.note, 'seq', seq.next + dur * 0.7); }
        seq.queue.push({ pos: seq.pos, time: seq.next });
        seq.pos = (seq.pos + 1) % 16; seq.next += dur;
      }
    }
    function syncClock() {
      const need = arp.on || seq.on;
      if (need && !clockT) { clockT = setInterval(clockTick, 25); }
      if (!need && clockT) { clearInterval(clockT); clockT = 0; }
    }
    function setArp(onn) {
      arp.on = onn;
      if (onn) { if (!engine()) { arp.on = false; return; } arp.next = ac.currentTime + 0.05; arp.i = 0; arp.list = [...keyEls.keys()].filter(n => syn.held().includes(n)); arp.srcs = new Map(); }
      else { for (const n of arp.playing) { try { syn.noteOff(n, 'arp'); } catch (e) { /* done */ } } arp.playing.clear(); arp.list = []; arp.srcs.clear(); }
      arpSwitch.classList.toggle('is-on', onn); arpSwitch.setAttribute('aria-checked', String(onn));
      syncClock();
    }
    function setSeq(onn) {
      seq.on = onn;
      if (onn) { if (!engine()) { seq.on = false; return; } seq.pos = 0; seq.next = ac.currentTime + 0.06; seq.queue = []; }
      else { seq.queue = []; seq.head = -1; paintSeqHead(); }
      seqPlay.replaceChildren(icon(onn ? 'square' : 'play'), h('span', { text: onn ? 'Stop' : 'Play' }));
      seqPlay.setAttribute('aria-label', onn ? 'Stop sequence' : 'Play sequence');
      syncClock();
    }
    function saveSeq() { store.set(K + '.seq', seq.steps.map(x => ({ ...x }))); }

    /* ---------- the drawer: Arpeggiator, Sequencer, Record, Files ---------- */
    const bpmVal = h('span.piano__bpmval');
    const bpmSlider = h('input.slider.synth__bpm', { type: 'range', min: '40', max: '240', step: '1', value: String(S.bpm), 'aria-label': 'Tempo in beats per minute',
      oninput: e => { S.bpm = +e.target.value; bpmVal.textContent = `${S.bpm} BPM`; persist(); } });
    bpmVal.textContent = `${S.bpm} BPM`;
    const arpSwitch = h('button.switch', { role: 'switch', 'aria-label': 'Arpeggiator', 'aria-checked': 'false', onclick: () => setArp(!arp.on) });
    const arpMode = h('select.synth__sel', { 'aria-label': 'Arpeggiator pattern', onchange: e => { arp.mode = e.target.value; } }, ARP_MODES.map(([v, t]) => h('option', { value: v, text: t })));
    const arpRate = h('select.synth__sel', { 'aria-label': 'Arpeggiator speed', onchange: e => { arp.rate = +e.target.value; } }, RATES.map(([v, t]) => h('option', { value: String(v), text: t, selected: v === 2 })));
    const arpOct = h('select.synth__sel', { 'aria-label': 'Arpeggiator octaves', onchange: e => { arp.oct = +e.target.value; } }, [1, 2, 3, 4].map(n => h('option', { value: String(n), text: `${n} octave${n > 1 ? 's' : ''}` })));
    const arpGate = h('input.slider', { type: 'range', min: '15', max: '100', step: '5', value: '60', 'aria-label': 'Arpeggiator note length', oninput: e => { arp.gate = (+e.target.value) / 100; } });
    const paneArp = h('div.piano__pane',
      h('div.piano__row', h('label.piano__lab', h('span', { text: 'Arpeggiator' }), arpSwitch), arpMode, arpRate, arpOct, h('label.piano__lab', h('span', { text: 'Length' }), arpGate)),
      h('div.piano__row', h('label.piano__lab', h('span', { text: 'Tempo' }), bpmSlider, bpmVal)),
      h('span.piano__tuneinfo', { text: 'Hold some keys and the arpeggiator plays them as a pattern. Turn Hold on to keep the notes after you let go.' }));

    const stepEls = [];
    const stepRow = h('div.synth__steps', { role: 'group', 'aria-label': '16-step sequencer' });
    seq.steps.forEach((st, i) => {
      const b = h('button.synth__step', { type: 'button', 'aria-pressed': String(st.on), 'aria-label': `Step ${i + 1}`, dataset: { step: String(i) },
        onclick: () => { st.on = !st.on; b.classList.toggle('is-on', st.on); b.setAttribute('aria-pressed', String(st.on)); saveSeq(); } }, h('span', { text: String(i + 1) }));
      b.classList.toggle('is-on', st.on);
      const sel = h('select.synth__stepnote', { 'aria-label': `Step ${i + 1} note`, onchange: e => { st.note = +e.target.value; saveSeq(); } },
        Array.from({ length: SEQ_HI - SEQ_LO + 1 }, (_, k) => h('option', { value: String(SEQ_LO + k), text: noteName(SEQ_LO + k), selected: SEQ_LO + k === st.note })));
      stepEls[i] = b;
      stepRow.appendChild(h('div.synth__stepcol', b, sel));
    });
    const seqPlay = h('button.btn.btn--sm.btn--primary', { type: 'button', 'aria-label': 'Play sequence', onclick: () => setSeq(!seq.on) }, icon('play'), h('span', { text: 'Play' }));
    const seqClear = h('button.btn.btn--sm', { type: 'button', 'aria-label': 'Clear sequence', onclick: () => { seq.steps.forEach(s => { s.on = false; }); stepEls.forEach(b => { b.classList.remove('is-on'); b.setAttribute('aria-pressed', 'false'); }); saveSeq(); } }, icon('trash'), h('span', { text: 'Clear' }));
    const seqRand = h('button.btn.btn--sm', { type: 'button', 'aria-label': 'Random sequence', onclick: () => {
      const scale = [0, 3, 5, 7, 10];                    /* minor pentatonic: any line sounds fine */
      seq.steps.forEach((s, i) => { s.on = Math.random() < 0.6; s.note = 48 + scale[Math.floor(Math.random() * 5)] + 12 * Math.floor(Math.random() * 2); stepEls[i].classList.toggle('is-on', s.on); stepEls[i].setAttribute('aria-pressed', String(s.on)); stepRow.children[i].querySelector('select').value = String(s.note); });
      saveSeq();
    } }, icon('shuffle'), h('span', { text: 'Random' }));
    function paintSeqHead() {
      if (!seq.on || !ac) { if (seq.head !== -1) { stepEls.forEach(b => b.classList.remove('is-play')); seq.head = -1; } return; }
      let p = seq.head;
      while (seq.queue.length && seq.queue[0].time <= ac.currentTime) p = seq.queue.shift().pos;
      if (p !== seq.head) { stepEls.forEach((b, i) => b.classList.toggle('is-play', i === p)); seq.head = p; }
    }
    const paneSeq = h('div.piano__pane', h('div.piano__row', seqPlay, seqClear, seqRand, h('label.piano__lab', h('span', { text: 'Tempo' }), h('span.piano__bpmval', { text: 'same slider as the arpeggiator' }))), stepRow,
      h('span.piano__tuneinfo', { text: 'Sixteen 1/16 steps. Switch a step on and choose its note. The tempo is the Arpeggiator tab’s slider.' }));

    /* record a take and save it to Music */
    const rec = { on: false, start: 0, events: [], patch: null };
    function recNote(note, vel, down, when) {
      if (!rec.on || !ac) return;
      rec.events.push({ t: Math.max(0, (when == null ? ac.currentTime : when) - rec.start), note, vel, d: down ? 1 : 0 });
    }
    function recSus(d) { if (rec.on && ac) rec.events.push({ t: ac.currentTime - rec.start, sus: d ? 1 : 0 }); }
    const recBtn = h('button.btn.btn--sm.piano__rec', { type: 'button', 'aria-label': 'Record a take', onclick: toggleRec }, h('span.piano__recdot'), h('span', { text: 'Record' }));
    const saveTakeBtn = h('button.btn.btn--sm', { type: 'button', 'aria-label': 'Save take to Music', disabled: true, onclick: saveTake }, icon('save'), h('span', { text: 'Save take' }));
    const recInfo = h('span.piano__tuneinfo', { role: 'status', 'aria-live': 'polite', text: 'Not recording.' });
    function toggleRec() {
      if (rec.on) { rec.on = false; recBtn.classList.remove('is-rec'); recBtn.lastChild.textContent = 'Record'; const n = rec.events.filter(e => e.d === 1).length; recInfo.textContent = n ? `${n} note${n === 1 ? '' : 's'} recorded. Press Save take.` : 'Nothing was played.'; saveTakeBtn.disabled = !n; return; }
      if (!engine()) return;
      rec.events = []; rec.patch = { ...S.patch }; rec.start = ac.currentTime; rec.on = true;
      if (S.hold || midiPedal) rec.events.push({ t: 0, sus: 1 });
      recBtn.classList.add('is-rec'); recBtn.lastChild.textContent = 'Stop'; saveTakeBtn.disabled = true;
      recInfo.textContent = 'Recording… play, or run the arpeggiator or sequencer.';
    }
    async function saveTake() {
      if (rec.on) toggleRec();
      if (!rec.events.length || typeof OfflineAudioContext === 'undefined') { recInfo.textContent = 'Nothing to save.'; return; }
      saveTakeBtn.disabled = true;
      try {
        const evs = [...rec.events].sort((a, b) => a.t - b.t);
        const dur = evs[evs.length - 1].t + 3.5, sr = 44100;
        const oc = new OfflineAudioContext(2, Math.ceil(dur * sr), sr);
        const engineOff = createSynth(oc, { patch: rec.patch, offline: true, maxVoices: 2048 });
        for (const e of evs) {
          if (e.sus != null) engineOff.sustain(!!e.sus, e.t);
          else if (e.d) engineOff.noteOn(e.note, e.vel || 0.9, 'take', e.t);
          else engineOff.noteOff(e.note, 'take', e.t);
        }
        const out = await oc.startRendering();
        const bytes = encodeWav({ rate: sr, ch: [out.getChannelData(0), out.getChannelData(1)] });
        const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
        const { path } = await media.save(api.vfs.HOME + '/Music', `Synth take ${stamp}.wav`, new Blob([bytes], { type: 'audio/wav' }));
        recInfo.textContent = `Saved ${api.vfs.baseName(path)} to Music.`;
        try { engineOff.dispose(); } catch (e) { /* done */ }
        notify({ app: 'Static Synth', icon: 'save', title: 'Saved to Music', message: api.vfs.baseName(path), actions: [{ label: 'Open in Music', onClick: () => api.openApp('music') }] });
      } catch (e) { recInfo.textContent = 'Could not save the take: ' + String(e && e.message || e); }
      finally { saveTakeBtn.disabled = !rec.events.length; }
    }
    const paneRec = h('div.piano__pane', h('div.piano__row', recBtn, saveTakeBtn), recInfo,
      h('span.piano__tuneinfo', { text: 'A take keeps the notes (from your keys, the arpeggiator and the sequencer) and Hold, with the sound it started with. Pitch bend and sound changes made during the take are not kept.' }));

    const TABS = [['arp', 'Arpeggiator', paneArp], ['seq', 'Sequencer', paneSeq], ['rec', 'Record', paneRec]];
    const drawer = h('div.piano__drawer', { hidden: true });
    const tabBtns = new Map();
    let tab = '';
    function openTab(id) {
      tab = tab === id ? '' : id;
      for (const [k, b] of tabBtns) { b.classList.toggle('is-on', k === tab); b.setAttribute('aria-pressed', String(k === tab)); }
      drawer.hidden = !tab;
      drawer.replaceChildren(...TABS.filter(t => t[0] === tab).map(t => t[2]));
    }
    const tabBar = h('div.piano__tabs', { role: 'group', 'aria-label': 'Play with the synth' },
      TABS.map(([id, label]) => { const b = h('button.piano__segbtn', { type: 'button', dataset: { tab: id }, 'aria-pressed': 'false', onclick: () => openTab(id) }, label); tabBtns.set(id, b); return b; }));

    /* ---------- layout ---------- */
    const bar = h('div.app__bar.piano__bar',
      h('div.app__title', { text: 'Static Synth' }), h('div.grow'),
      h('div.synth__top', presetSel, btnSave, nameRow, btnDel,
        h('label.synth__vol', icon('volume-2'), volSlider)));
    const bar2 = h('div.synth__bar2', btnRand, btnExp, btnImp, h('span.piano__tuneinfo', { text: 'Random makes a new sound. Export saves a preset file to send to a friend; Import reads one from your Files.' }));
    const foot = h('div.synth__foot',
      h('div.piano__group', h('span.piano__glabel', { text: 'Octave' }),
        h('div.piano__oct',
          h('button.ibtn', { type: 'button', 'aria-label': 'Octave down', onclick: () => shiftOct(-1) }, icon('chevron-down')), octLabel,
          h('button.ibtn', { type: 'button', 'aria-label': 'Octave up', onclick: () => shiftOct(1) }, icon('chevron-up')))),
      h('div.piano__group', h('span.piano__glabel', { text: 'Hold' }), holdSwitch),
      h('div.piano__group.piano__group--wide', h('span.piano__glabel', { text: 'Pitch bend' }), bendSlider),
      h('div.piano__group', h('span.piano__glabel', { text: 'Voice limit' }), h('div.piano__slid', voiceSlider, voiceOut)),
      h('div.piano__group.piano__group--wide.piano__midi', h('span.piano__glabel', { text: 'MIDI keyboard' }),
        h('div.piano__slid', midiSwitch, midiLast, padLit), midiStatus),
    );
    root.appendChild(h('div.app.app--col.piano.synth', { 'data-sfx': 'off' }, bar, bar2, fileHost, panel, err, tabBar, drawer, foot, h('div.piano__stage', boardWrap)));
    for (const [k, c] of ctl) if (c.input) paintCtl(k, c);
    ctl.get('volume').input.value = String(Math.round(S.patch.volume * 1000));
    paintOct(); paintPreset(); paintVoices(); drawScope();

    /* ---------- input ---------- */
    const pointers = new Map();
    const onDown = e => { const k = e.target.closest && e.target.closest('.pkey'); if (!k) return; e.preventDefault(); const n = +k.dataset.midi; pointers.set(e.pointerId, n); on(n, 0.9, 'ptr:' + e.pointerId); };
    const onMove = e => {
      if (!pointers.has(e.pointerId)) return;
      const el = document.elementFromPoint(e.clientX, e.clientY), k = el && el.closest('.pkey');
      const n = k ? +k.dataset.midi : null, cur = pointers.get(e.pointerId);
      if (n === cur) return;
      if (cur != null) off(cur, 'ptr:' + e.pointerId);
      pointers.set(e.pointerId, n);
      if (n != null) on(n, 0.9, 'ptr:' + e.pointerId);
    };
    const onUp = e => { if (!pointers.has(e.pointerId)) return; const cur = pointers.get(e.pointerId); if (cur != null) off(cur, 'ptr:' + e.pointerId); pointers.delete(e.pointerId); };
    boardWrap.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);

    const downKeys = new Map();
    const onKeyDown = e => {
      if (!win.el.classList.contains('is-active') || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const key = e.key.toLowerCase();
      if (key === 'z' || key === 'x') { e.preventDefault(); if (!e.repeat) shiftOct(key === 'z' ? -1 : 1); return; }
      if (KEYMAP[key] === undefined) return;
      e.preventDefault();
      if (e.repeat || downKeys.has(key)) return;
      const n = base() + KEYMAP[key];
      downKeys.set(key, n);
      on(n, 0.9, 'kbd:' + key);
    };
    const onKeyUp = e => {
      const key = e.key.toLowerCase();
      if (!downKeys.has(key)) return;
      const n = downKeys.get(key); downKeys.delete(key); off(n, 'kbd:' + key);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    const onBlur = () => allOff();
    const onVis = () => { if (document.hidden) allOff(); else if (syn) startRaf(); };
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVis);
    const tick = setInterval(paintVoices, 150);
    root.querySelector('.synth').synthPeek = () => ({ arp: { on: arp.on, list: [...arp.list], mode: arp.mode }, seq: { on: seq.on, steps: seq.steps.map(x => ({ ...x })) }, rec: { on: rec.on, events: rec.events.length }, patch: { ...S.patch }, hold: S.hold, voices: syn ? syn.voices() : 0, scope: an ? true : false });
    root.querySelector('.synth').synthSyn = () => syn;           /* play-tests only */

    return () => {
      clearInterval(tick); if (clockT) clearInterval(clockT);
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('blur', onBlur); document.removeEventListener('visibilitychange', onVis);
      boardWrap.removeEventListener('pointerdown', onDown);
      midi.disable();
      if (syn) { try { syn.allNotesOff(); syn.dispose(); } catch (e) { /* closing */ } syn = null; }
      if (ac) { try { ac.close(); } catch (e) { /* closing */ } ac = null; }
    };
  },
});
