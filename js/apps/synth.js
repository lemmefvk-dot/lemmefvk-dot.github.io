/* ============================================================
   synth.js — Static Synth

   A playable WebAudio synthesizer. The sound engine is js/core/synth.js
   (oscillators, envelope, filter, LFO, delay, voice limit, limiter); this
   file is the panel and the inputs: on-screen keys, the computer keyboard
   (a·w·s·e·d…, z / x for octaves) and MIDI (js/core/midi.js, asked for
   only when its switch is turned on). All three call the same
   noteOn / noteOff, so they behave identically.

   Presets: eight factory sounds plus your own ("Save as"), kept in the
   app's saved state. Close, blur or tab-hide lets go of every note, and
   closing stops the oscillators and closes the AudioContext.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { createSynth, cleanPatch, PRESETS, RANGES, KEYMAP } from '../core/synth.js';
import { createMidi, describe as describeMidi } from '../core/midi.js';

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
const unit = { cutoff: v => (v >= 1000 ? (v / 1000).toFixed(1) + ' kHz' : Math.round(v) + ' Hz'), a: s, d: s, r: s, fdecay: s, delayTime: s, lfoRate: v => v.toFixed(1) + ' Hz', lfoPitch: v => Math.round(v) + ' ct', lfoFilter: v => Math.round(v) + ' ct', o2detune: v => Math.round(v) + ' ct', o1oct: o, o2oct: o };
function s(v) { return v < 1 ? Math.round(v * 1000) + ' ms' : v.toFixed(2) + ' s'; }
function o(v) { return (v > 0 ? '+' : '') + v; }
const fmtVal = (k, v) => (unit[k] ? unit[k](v) : (k === 's' || k.startsWith('delayMix') || k === 'o2level' || k === 'volume' || k === 'delayFb') ? Math.round(v * 100) + '%' : Number(v).toFixed(1));

defineApp({
  id: 'synth',
  name: 'Static Synth',
  icon: 'sliders',
  g1: '#9a7dff', g2: '#4d27cf',
  category: 'Media',
  keywords: ['synth', 'synthesizer', 'synthesiser', 'oscillator', 'filter', 'envelope', 'preset', 'keyboard', 'midi', 'music', 'instrument', 'delay', 'lfo'],
  desc: 'Play a synthesizer with presets, from keys or a MIDI keyboard',
  singleton: true,
  win: { w: 880, h: 660, minW: 440, minH: 440 },
  shortcuts: [
    ['A / W / S / E / D / F / T / G / Y / H / U / J / K', 'Play the notes (the letters are printed on the keys)'],
    ['Z / X', 'Octave down / up'],
  ],

  mount(ctx) {
    const { root, win, api } = ctx;
    const { h, icon, store } = api;
    const K = 'portal.synth';
    const saved = store.get(K) || {};
    const userPresets = () => (store.get(K + '.user') || []).filter(p => p && typeof p.name === 'string').map(p => ({ id: String(p.id), name: p.name.slice(0, 40), p: cleanPatch(p.p) }));

    const S = {
      patch: cleanPatch(saved.cur || PRESETS[0].p),
      presetId: typeof saved.presetId === 'string' ? saved.presetId : PRESETS[0].id,
      octave: clamp(Number.isFinite(saved.octave) ? saved.octave : 3, 1, 6),
      maxVoices: clamp(Number.isFinite(saved.maxVoices) ? saved.maxVoices : 8, 1, 16),
    };
    const persist = () => store.set(K, { ...(store.get(K) || {}), cur: S.patch, presetId: S.presetId, octave: S.octave, maxVoices: S.maxVoices });

    /* ---------- audio ---------- */
    let ac = null, syn = null;
    const AC = window.AudioContext || window.webkitAudioContext;
    function engine() {
      if (syn) { if (ac.state === 'suspended') ac.resume().catch(() => {}); return syn; }
      if (!AC) { err.textContent = 'This browser has no Web Audio, so the synth cannot make sound.'; return null; }
      try { ac = new AC(); } catch (e) { err.textContent = 'The audio engine could not start.'; return null; }
      syn = createSynth(ac, { patch: S.patch, maxVoices: S.maxVoices });
      ac.resume().catch(() => {});
      return syn;
    }
    const on = (note, vel, src) => { const e = engine(); if (e) { e.noteOn(note, vel, src); mark(note, true); } };
    const off = (note, src) => { if (syn) { syn.noteOff(note, src); if (!syn.held().includes(note) && !syn.sustained().includes(note)) mark(note, false); } };
    function allOff() {
      if (syn) syn.allNotesOff();
      keyEls.forEach(el => el.classList.remove('is-down'));
      downKeys.clear(); pointers.clear();
      padLit.classList.remove('is-on');
    }

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

    const sec = (title, ...kids) => h('section.synth__sec', h('h3.synth__h', { text: title }), ...kids);
    const panel = h('div.synth__panel',
      sec('Oscillator 1', select('o1wave', 'Wave 1', WAVE_OPTS), slider('o1oct', 'Octave 1')),
      sec('Oscillator 2', select('o2wave', 'Wave 2', WAVE_OPTS), slider('o2level', 'Level 2'), slider('o2oct', 'Octave 2'), slider('o2detune', 'Detune 2')),
      sec('Envelope', slider('a', 'Attack'), slider('d', 'Decay'), slider('s', 'Sustain'), slider('r', 'Release')),
      sec('Filter', select('filter', 'Filter type', [['lowpass', 'Low-pass'], ['highpass', 'High-pass'], ['bandpass', 'Band-pass']]), slider('cutoff', 'Cutoff'), slider('res', 'Resonance'), slider('fenv', 'Filter envelope'), slider('fdecay', 'Filter decay')),
      sec('Modulation', select('lfoWave', 'LFO wave', WAVE_OPTS), slider('lfoRate', 'LFO rate'), slider('lfoPitch', 'Vibrato'), slider('lfoFilter', 'Filter wobble')),
      sec('Delay', slider('delayTime', 'Delay time'), slider('delayFb', 'Feedback'), slider('delayMix', 'Delay mix')),
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
    function doSave() {
      let name = nameIn.value.replace(/\s+/g, ' ').trim().slice(0, 40);
      if (!name) { nameIn.focus(); return; }
      if (PRESETS.some(p => p.name.toLowerCase() === name.toLowerCase())) name += ' (mine)';
      const mine = userPresets();
      const same = mine.find(p => p.name.toLowerCase() === name.toLowerCase());
      if (!same && mine.length >= 40) { err.textContent = 'You can keep up to 40 presets. Delete one first.'; return; }
      const id = same ? same.id : 'u' + Date.now().toString(36);
      store.set(K + '.user', [...mine.filter(p => p.id !== id), { id, name, p: S.patch }]);
      S.presetId = id; nameRow.hidden = true; nameIn.value = ''; err.textContent = '';
      paintPreset(); persist();
    }
    const btnSave = h('button.btn.btn--sm', { type: 'button', onclick: () => { nameRow.hidden = !nameRow.hidden; if (!nameRow.hidden) nameIn.focus(); } }, icon('save'), h('span', { text: 'Save as…' }));
    const btnDel = h('button.btn.btn--sm', { type: 'button', 'aria-label': 'Delete preset', onclick: () => {
      store.set(K + '.user', userPresets().filter(p => p.id !== S.presetId));
      applyPatch(PRESETS[0].p, PRESETS[0].id);
    } }, icon('trash'));

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
        else if (ev.type === 'pedal') {
          padLit.classList.toggle('is-on', ev.down);
          if (syn) { syn.sustain(ev.down); if (!ev.down) keyEls.forEach((el, n) => { if (!syn.held().includes(n) && !syn.sustained().includes(n)) el.classList.remove('is-down'); }); }
        } else if (ev.type === 'allOff') allOff();
      },
      onChange: st => {
        midiStatus.textContent = describeMidi(st);
        const onn = st.status === 'on' || st.status === 'asking';
        midiSwitch.classList.toggle('is-on', onn); midiSwitch.setAttribute('aria-checked', String(onn)); midiSwitch.dataset.state = st.status;
      },
    });

    /* ---------- layout ---------- */
    const bar = h('div.app__bar.piano__bar',
      h('div.app__title', { text: 'Static Synth' }), h('div.grow'),
      h('div.synth__top', presetSel, btnSave, nameRow, btnDel,
        h('label.synth__vol', icon('volume-2'), volSlider)));
    const foot = h('div.synth__foot',
      h('div.piano__group', h('span.piano__glabel', { text: 'Octave' }),
        h('div.piano__oct',
          h('button.ibtn', { type: 'button', 'aria-label': 'Octave down', onclick: () => shiftOct(-1) }, icon('chevron-down')), octLabel,
          h('button.ibtn', { type: 'button', 'aria-label': 'Octave up', onclick: () => shiftOct(1) }, icon('chevron-up')))),
      h('div.piano__group', h('span.piano__glabel', { text: 'Voice limit' }), h('div.piano__slid', voiceSlider, voiceOut)),
      h('div.piano__group.piano__group--wide.piano__midi', h('span.piano__glabel', { text: 'MIDI keyboard' }),
        h('div.piano__slid', midiSwitch, midiLast, padLit), midiStatus),
    );
    root.appendChild(h('div.app.app--col.piano.synth', { 'data-sfx': 'off' }, bar, panel, err, foot, h('div.piano__stage', boardWrap)));
    for (const [k, c] of ctl) if (c.input) paintCtl(k, c);
    ctl.get('volume').input.value = String(Math.round(S.patch.volume * 1000));
    paintOct(); paintPreset(); paintVoices();

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
    const onVis = () => { if (document.hidden) allOff(); };
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVis);
    const tick = setInterval(paintVoices, 150);

    return () => {
      clearInterval(tick);
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
