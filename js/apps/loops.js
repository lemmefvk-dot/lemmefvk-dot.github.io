/* ============================================================
   loops.js — Loop Station

   Record a first loop from the microphone, then overdub layers that are
   locked to its length. Each layer has its own volume, Solo, Mute, Reverse
   and Half speed, a waveform with a play line, a name you can change, and its
   own Save. Undo takes off the newest. "Save mix" writes a WAV into ~/Music.
   Everything stays in this tab: nothing is uploaded.

   Why its own app: Recorder makes single takes and edits them; a loop
   station keeps several layers sounding together on one clock, which is a
   different job from either Recorder or Beats.

   Microphone: asked for only when you press Record, shown by a red
   "Recording" pill and a "Microphone on" pill, and released by "Mic off",
   by Clear, and when the window closes.

   Timing: samples come from an AudioWorklet (js/core/loopcapture.js) that
   runs on the audio thread and stamps each block with its audio-clock frame,
   so the loop length is an exact sample count and no block is dropped when
   the page is busy. An overdub starts at the next loop boundary and
   lasts exactly one loop. Speaker and mic delay make a layer land late, so
   it is shifted earlier by what the browser reports: AudioContext.
   outputLatency (or baseLatency) plus the mic track's settings.latency.
   When a browser reports neither, nothing is shifted and the screen says
   so; a Nudge control adds a manual offset on top.

   Tempo: the BPM is what you type, never detected. The metronome clicks on
   the beat from the top of the loop; a count-in plays one bar before the
   first take. "Trim to bars" cuts (or pads) the loop to a whole number of
   bars at that BPM. A Beats pattern from Static Beats can be added as a
   layer: it is drawn to the loop's length with Beats' own voices.

   Half speed plays a layer over two loops at half pitch; Save mix is then
   two loops long so nothing is cut.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import media from '../core/media.js';
import W, { encodeWav, mix, peakOf, rotate } from '../core/wavedit.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-audioplus-css')) {
  const l = document.createElement('link');
  l.id = 'feat-audioplus-css'; l.rel = 'stylesheet'; l.href = 'css/feat-audioplus.css';
  document.head.appendChild(l);
}
const MAX_LOOP_S = 60, MAX_LAYERS = 16;
const WORKLET = new URL('../core/loopcapture.js', import.meta.url).href;

defineApp({
  id: 'loops',
  name: 'Loop Station',
  icon: 'mic',
  g1: '#bb6ff8', g2: '#6a1cc4',
  category: 'Media',
  keywords: ['loop', 'looper', 'loop station', 'overdub', 'layers', 'record', 'microphone', 'mic', 'music', 'beatbox'],
  desc: 'Record a loop from your microphone and layer more on top',
  singleton: true,
  win: { w: 560, h: 560, minW: 380, minH: 420 },
  shortcuts: [
    ['Space', 'Record, stop, or overdub: whatever the big button says'],
    ['U', 'Undo (take off the newest layer)'],
    ['M', 'Metronome on or off'],
  ],

  mount(ctx) {
    const { root, api, win } = ctx;
    const { h, icon } = api;
    const AC = window.AudioContext || window.webkitAudioContext;

    const S = { phase: 'idle', layers: [], len: 0, nudge: 0, comp: null, note: '', bpm: 100, beats: 4, metro: false, countIn: false };
    let ac = null, stream = null, src = null, proc = null, sink = null, out = null, clickBus = null;
    let loopStart = 0, nextId = 1, cap = null, hist = [], mk = null;
    let closed = false, wired = null;

    /* ---------- audio plumbing ---------- */
    function ensureAc() {
      if (!AC) { say('This browser has no Web Audio.', true); return false; }
      if (!ac) {
        ac = new AC(); out = ac.createGain(); out.connect(ac.destination);
        clickBus = ac.createGain(); clickBus.gain.value = 0.5; clickBus.connect(ac.destination);
      }
      return true;
    }
    async function openMic() {
      if (stream && stream.getTracks().some(t => t.readyState === 'live')) return true;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { say('This browser cannot reach a microphone.', true); return false; }
      if (!ensureAc()) return false;
      let st;
      try {
        st = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      } catch (e) {
        say(e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'The microphone was not allowed, so nothing can be recorded. Allow it in the address bar and try again.' : 'No microphone could be opened' + (e && e.message ? ': ' + e.message : '.'), true);
        return false;
      }
      if (closed) { st.getTracks().forEach(t => t.stop()); return false; }
      try { await ac.resume(); } catch (e) { /* stays suspended */ }
      /* the capture node lives on the audio thread; its module loads once per context */
      try {
        if (!ac.audioWorklet) throw new Error('this browser has no AudioWorklet');
        if (!wired || wired !== ac) { await ac.audioWorklet.addModule(WORKLET); wired = ac; }
      } catch (e) {
        st.getTracks().forEach(t => { try { t.stop(); } catch (e2) { /* ended */ } });
        say('Recording could not start: the capture module did not load' + (e && e.message ? ' (' + e.message + ')' : '') + '.', true);
        return false;
      }
      if (closed || !ac) { st.getTracks().forEach(t => t.stop()); return false; }
      stream = st;
      src = ac.createMediaStreamSource(stream);
      proc = new AudioWorkletNode(ac, 'loop-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit' });
      sink = ac.createGain(); sink.gain.value = 0;               /* keeps the node pulled without feeding the mic to the speakers */
      proc.port.onmessage = onChunk;
      src.connect(proc); proc.connect(sink); sink.connect(ac.destination);
      latency();
      paint();
      return true;
    }
    function micOff() {
      if (proc) { proc.port.onmessage = null; try { proc.disconnect(); } catch (e) { /* gone */ } proc = null; }
      if (src) { try { src.disconnect(); } catch (e) { /* gone */ } src = null; }
      if (sink) { try { sink.disconnect(); } catch (e) { /* gone */ } sink = null; }
      if (stream) { stream.getTracks().forEach(t => { try { t.stop(); } catch (e) { /* ended */ } }); stream = null; }
      hist = [];
    }
    const micIsOn = () => !!stream;

    /* what the browser says the round trip is, in seconds (null parts are unknown) */
    function latency() {
      const outL = ac && Number.isFinite(ac.outputLatency) && ac.outputLatency > 0 ? ac.outputLatency : (ac && Number.isFinite(ac.baseLatency) && ac.baseLatency > 0 ? ac.baseLatency : null);
      let inL = null;
      try { const l = stream && stream.getAudioTracks()[0].getSettings().latency; if (Number.isFinite(l) && l > 0) inL = l; } catch (e) { /* unknown */ }
      S.comp = { out: outL, inn: inL, total: (outL || 0) + (inL || 0), known: outL != null || inL != null };
    }
    const compSamples = () => Math.max(0, Math.round(((S.comp ? S.comp.total : 0) + S.nudge / 1000) * ac.sampleRate));

    /* a block of samples from the worklet, with the audio-clock frame of its first sample */
    function onChunk(e) {
      if (!ac) return;
      const { d, frame } = e.data;
      const t0 = frame / ac.sampleRate, tEnd = t0 + d.length / ac.sampleRate;
      const chunk = { d, t0 };
      const keep = () => { hist.push(chunk); if (hist.length > 3) hist.shift(); };
      if (!cap) { keep(); return; }
      if (cap.boundary != null && !cap.started) {
        if (tEnd < cap.boundary) { keep(); return; }
        cap.started = true;
        /* begin exactly at the boundary, even if it fell inside an earlier block */
        const parts = [...hist.slice(-2), chunk];
        let skip = Math.max(0, Math.round((cap.boundary - parts[0].t0) * ac.sampleRate));
        cap.chunks = []; cap.total = 0;
        for (const p of parts) {
          const a = p.d;
          if (skip >= a.length) { skip -= a.length; continue; }
          const part = skip > 0 ? a.subarray(skip) : a; skip = 0;
          cap.chunks.push(part); cap.total += part.length;
        }
      } else { cap.chunks.push(d); cap.total += d.length; }
      if (cap.kind === 'over' && cap.total >= S.len) finishOver();
    }
    const join = (chunks, len) => { const o = new Float32Array(len); let p = 0; for (const c of chunks) { if (p >= len) break; const k = Math.min(c.length, len - p); o.set(c.subarray(0, k), p); p += k; } return o; };

    /* ---------- loop playback (one looping source per layer, all on one clock) ---------- */
    const anySolo = () => S.layers.some(l => l.solo);
    const level = L => (L.muted || (anySolo() && !L.solo) ? 0 : L.vol);
    const refreshGains = () => S.layers.forEach(L => { if (L.gainNode) L.gainNode.gain.value = level(L); });
    function playLayer(L) {
      stopLayer(L);
      const b = ac.createBuffer(1, L.data.length, ac.sampleRate);
      b.copyToChannel(L.data, 0);
      const s = ac.createBufferSource(); s.buffer = b; s.loop = true;
      const rate = L.half ? 0.5 : 1;
      s.playbackRate.value = rate;
      const g = ac.createGain(); g.gain.value = level(L);
      s.connect(g); g.connect(out);
      const len = S.len / ac.sampleRate;
      const pos = ((((ac.currentTime - loopStart) * rate) % len) + len) % len;
      s.start(0, pos);
      L.node = s; L.gainNode = g;
    }
    function stopLayer(L) { if (L.node) { try { L.node.stop(); } catch (e) { /* stopped */ } try { L.node.disconnect(); L.gainNode.disconnect(); } catch (e) { /* gone */ } L.node = null; L.gainNode = null; } }
    function startAll() { loopStart = ac.currentTime; mk = null; S.layers.forEach(playLayer); }
    function stopAllPlay() { S.layers.forEach(stopLayer); }
    const mkLayer = (name, data) => ({ id: nextId++, name, data, muted: false, solo: false, vol: 1, rev: false, half: false });

    /* ---------- metronome (a short scheduler on the audio clock) ---------- */
    function click(t, accent) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'square'; o.frequency.value = accent ? 1500 : 1000;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(accent ? 0.9 : 0.55, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      o.connect(g); g.connect(clickBus); o.start(t); o.stop(t + 0.06);
    }
    function metroTick() {
      if (!ac || ac.state === 'closed') return;
      const horizon = ac.currentTime + 0.15, beat = 60 / S.bpm, now = ac.currentTime;
      if (cap && cap.kind === 'first' && (S.phase === 'count' || S.phase === 'first')) {
        /* free-running beats from the press, so the count-in leads straight into the take */
        if (!mk || mk.free !== cap) mk = { free: cap, k: 0 };
        for (;;) {
          const t = cap.t0 + mk.k * beat;
          if (t >= horizon) break;
          const counting = t < cap.boundary - 0.001;
          if ((counting || S.metro) && t >= now - 0.02) click(t, mk.k % S.beats === 0);
          mk.k++;
        }
        return;
      }
      if (!S.metro || !S.len || S.phase === 'stopped' || S.phase === 'idle') return;
      const L = S.len / ac.sampleRate;
      if (!mk || mk.ls !== loopStart) {
        const e = Math.max(0, now - loopStart);
        mk = { ls: loopStart, m: Math.floor(e / L), j: Math.ceil((e % L) / beat - 1e-6) };
      }
      for (let guard = 0; guard < 400; guard++) {
        const t = loopStart + mk.m * L + mk.j * beat;
        if (t >= horizon) break;
        if (mk.j * beat >= L - 0.01) { mk.m++; mk.j = 0; continue; }
        if (t >= now - 0.02) click(t, mk.j % S.beats === 0);
        mk.j++;
      }
    }

    /* ---------- actions ---------- */
    async function recordFirst() {
      if (!(await openMic())) return;
      const now = ac.currentTime, beat = 60 / S.bpm, t0 = now + 0.06;
      const count = S.countIn ? S.beats : 0;
      /* capture starts on a boundary even with no count-in, so the clicks and the take share a start */
      cap = { kind: 'first', chunks: [], total: 0, t0, boundary: t0 + count * beat, started: false };
      S.phase = count ? 'count' : 'first';
      say(count ? `Count-in: ${count} beats at ${S.bpm} BPM, then it records.` : ''); paint();
    }
    function finishFirst() {
      const c = cap; cap = null;
      const len = Math.min(c.total, MAX_LOOP_S * ac.sampleRate);
      if (len < ac.sampleRate * 0.2) { S.phase = 'idle'; say('That was too short for a loop. Press Record and play for at least a second.', true); paint(); return; }
      S.len = len;
      S.layers = [mkLayer('Loop', join(c.chunks, len))];
      S.phase = 'playing';
      startAll();
      say(`Loop of ${(len / ac.sampleRate).toFixed(2)} s recorded. Press Overdub to add a layer.`);
      paint();
    }
    async function overdub() {
      if (!S.len || S.layers.length >= MAX_LAYERS) return;
      if (!(await openMic())) return;
      latency();
      const L = S.len / ac.sampleRate;
      const boundary = loopStart + Math.ceil((ac.currentTime - loopStart) / L + 1e-6) * L;
      cap = { kind: 'over', boundary, started: false, chunks: [], total: 0 };
      S.phase = 'armed'; say('Overdub starts at the top of the loop.'); paint();
    }
    function finishOver() {
      const c = cap; cap = null;
      let data = join(c.chunks, S.len);
      const k = compSamples();
      if (k) data = rotate(data, k);
      S.layers.push(mkLayer('Layer ' + S.layers.length, data));
      playLayer(S.layers[S.layers.length - 1]);
      S.phase = 'playing';
      const ms = v => Math.round(v * 1000);
      say(S.comp && S.comp.known
        ? `Layer added, shifted ${ms(k / ac.sampleRate)} ms earlier to cancel the delay the browser reports (output ${S.comp.out != null ? ms(S.comp.out) + ' ms' : 'unknown'}, microphone ${S.comp.inn != null ? ms(S.comp.inn) + ' ms' : 'unknown'}${S.nudge ? `, nudge ${S.nudge} ms` : ''}).`
        : `Layer added. This browser does not report its audio delay, so the layer was not shifted${S.nudge ? ` except by your nudge of ${S.nudge} ms` : ''}. If it sounds late, raise Nudge.`);
      paint();
    }
    function stopPress() {
      if (S.phase === 'first') finishFirst();
      else if (S.phase === 'count') { cap = null; S.phase = 'idle'; say('Count-in cancelled.'); paint(); }
      else if (S.phase === 'armed' || S.phase === 'over') { cap = null; S.phase = 'playing'; say('Overdub cancelled.'); paint(); }
    }
    function togglePlay() {
      if (!S.len) return;
      if (S.phase === 'stopped') { S.phase = 'playing'; startAll(); } else { stopAllPlay(); S.phase = 'stopped'; cap = null; }
      paint();
    }
    function undo() { const L = S.layers.pop(); if (L) stopLayer(L); if (!S.layers.length) reset(); else { say('Removed ' + L.name + '.'); refreshGains(); paint(); } }
    function removeLayer(id) {
      const i = S.layers.findIndex(l => l.id === id); if (i < 0) return;
      const [L] = S.layers.splice(i, 1); stopLayer(L);
      if (!S.layers.length) reset(); else { refreshGains(); paint(); }
    }
    function reset() { stopAllPlay(); cap = null; S.layers = []; S.len = 0; S.phase = 'idle'; mk = null; say(''); micOff(); paint(); }

    /* what one layer contributes over `cycles` loops, as one array */
    function layerSamples(L, cycles) {
      const total = S.len * cycles, o = new Float32Array(total);
      const d = L.half ? W.stretch(L.data, S.len * 2) : L.data;
      for (let i = 0; i < total; i++) o[i] = d[i % d.length];
      return o;
    }
    async function save() {
      if (!S.layers.length) return;
      const live = S.layers.filter(l => level(l) > 0);
      if (!live.length) { say('Every layer is muted, so there is nothing to save.', true); return; }
      const cycles = live.some(l => l.half) ? 2 : 1;
      const m = mix(ac.sampleRate, S.len * cycles, live.map(l => ({ ch: [layerSamples(l, cycles)], gain: l.vol })), 1);
      const pk = peakOf(m);
      let scaled = false;
      if (pk > 0.98) { const f = 0.98 / pk; const d = m.ch[0]; for (let i = 0; i < d.length; i++) d[i] *= f; scaled = true; }
      try {
        const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
        const { path } = await media.save(api.vfs.HOME + '/Music', `Loop mix ${stamp}.wav`, new Blob([encodeWav(m)], { type: 'audio/wav' }));
        say(`Saved ${api.vfs.baseName(path)} to Music${cycles === 2 ? ' (two loops long, because a layer is at half speed)' : ''}${scaled ? ' (turned down a little so the layers do not clip)' : ''}.`);
      } catch (e) { say('Could not save: ' + (e && e.message || e), true); }
      paint();
    }
    async function saveLayer(L) {
      const clip = { rate: ac.sampleRate, ch: [layerSamples(L, L.half ? 2 : 1).subarray(0, L.half ? S.len * 2 : S.len)] };
      try {
        const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
        const safe = L.name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Layer';
        const { path } = await media.save(api.vfs.HOME + '/Music', `Loop ${safe} ${stamp}.wav`, new Blob([encodeWav(clip)], { type: 'audio/wav' }));
        say(`Saved ${api.vfs.baseName(path)} to Music (this layer alone, without its volume or mute).`);
      } catch (e) { say('Could not save: ' + (e && e.message || e), true); }
    }
    function reverseLayer(L) {
      L.data = W.reverse({ rate: ac.sampleRate, ch: [L.data] }, 0, L.data.length).ch[0];
      L.rev = !L.rev;
      if (S.phase !== 'stopped') playLayer(L);
      say(`${L.name} is ${L.rev ? 'reversed' : 'back the right way round'}.`); paint();
    }
    function halfLayer(L) {
      L.half = !L.half;
      if (S.phase !== 'stopped') playLayer(L);
      say(L.half ? `${L.name} plays at half speed, an octave lower, over two loops.` : `${L.name} is back at normal speed.`); paint();
    }
    /* the loop made a whole number of bars at the BPM on screen */
    function trimToBars() {
      if (!S.len || (S.phase !== 'playing' && S.phase !== 'stopped')) return;
      const rate = ac.sampleRate, bar = S.beats * 60 / S.bpm * rate;
      const bars = Math.max(1, Math.round(S.len / bar));
      const n = Math.round(bars * bar);
      if (n === S.len) { say(`The loop is already ${bars} bar${bars === 1 ? '' : 's'} of ${S.beats} at ${S.bpm} BPM.`); return; }
      const before = S.len;
      S.layers.forEach(L => { const d = new Float32Array(n); d.set(L.data.subarray(0, Math.min(n, L.data.length))); L.data = d; });
      S.len = n;
      if (S.phase === 'playing') startAll();
      say(`${n < before ? 'Trimmed' : 'Padded with silence'} the loop from ${(before / rate).toFixed(2)} s to ${(n / rate).toFixed(2)} s: ${bars} bar${bars === 1 ? '' : 's'} of ${S.beats} at ${S.bpm} BPM.`);
      paint();
    }

    /* a Beats pattern as a layer, drawn to this loop's length */
    function beatsList() {
      const d = api.store.get('portal.beats');
      const list = d && Array.isArray(d.patterns) ? d.patterns.filter(p => p && typeof p.id === 'string') : [];
      const items = list.map(p => ({ name: String(p.name || 'Pattern').slice(0, 40), bpm: p.bpm, pat: p }));
      if (d && d.last && typeof d.last === 'object' && d.last.steps) items.push({ name: 'Beats, as you left it', bpm: d.last.bpm, pat: { ...d.last, id: 'last' } });
      return items;
    }
    function beatsMenu(e) {
      if (!S.len) return;
      const items = beatsList();
      if (!items.length) { say('There are no Beats patterns yet. Make one in Static Beats and press Save, then add it here.', true); return; }
      const r = e.currentTarget.getBoundingClientRect();
      api.menu(items.map(it => ({ label: it.name, icon: 'grid', hint: Number.isFinite(it.bpm) ? `${Math.round(it.bpm)} BPM` : '', onClick: () => addBeats(it) })), r.left, r.bottom + 4);
    }
    async function addBeats(it) {
      if (!S.len || S.layers.length >= MAX_LAYERS) return;
      say('Drawing the pattern…');
      try {
        const { renderPattern } = await import('../core/beatsrender.js');
        const r = await renderPattern(it.pat, S.len / ac.sampleRate, ac.sampleRate);
        if (closed || !S.len) return;
        if (!r.hits) { say(`“${it.name}” has no hits to play, so no layer was added.`, true); return; }
        S.layers.push(mkLayer(it.name.slice(0, 24), r.data));
        if (S.phase !== 'stopped') playLayer(S.layers[S.layers.length - 1]);
        say(`Added “${it.name}” as a layer: its ${r.bpm} BPM bar repeats across the ${(S.len / ac.sampleRate).toFixed(2)} s loop and is cut where the loop ends. Set the BPM above and use Trim to bars if you want it to fit exactly.`);
        paint();
      } catch (err) { say('Could not add the pattern: ' + (err && err.message || err), true); }
    }

    /* ---------- screen ---------- */
    const note = h('div.lp__note', { role: 'status', 'aria-live': 'polite' });
    function say(t, bad) { S.note = t; note.textContent = t; note.classList.toggle('is-bad', !!bad); }
    const pillRec = h('span.lp__pill.lp__pill--rec', { hidden: true, role: 'status', text: 'Recording' });
    const pillMic = h('span.lp__pill', { hidden: true, text: 'Microphone on' });
    const bRec = h('button.btn.btn--primary.lp__big', { type: 'button', onclick: () => (S.phase === 'idle' ? recordFirst() : stopPress()) });
    const bOver = h('button.btn.lp__big', { type: 'button', text: 'Overdub', onclick: overdub });
    const bPlay = h('button.btn', { type: 'button', onclick: togglePlay });
    const bUndo = h('button.btn', { type: 'button', text: 'Undo', onclick: undo });
    const bClear = h('button.btn', { type: 'button', text: 'Clear', onclick: reset });
    const bSave = h('button.btn', { type: 'button', text: 'Save mix', onclick: save });
    const bMic = h('button.btn', { type: 'button', text: 'Mic off', onclick: () => { cap = null; if (S.phase === 'first' || S.phase === 'count' || S.phase === 'armed' || S.phase === 'over') S.phase = S.len ? 'playing' : 'idle'; micOff(); paint(); } });
    const barFill = h('div.lp__fill'), bar = h('div.lp__bar', barFill);
    const list = h('ul.lp__layers', { 'aria-label': 'Layers' });
    const lat = h('div.lp__lat');
    const nudgeOut = h('span.mono', { text: '0 ms' });
    const nudge = h('input.slider', { type: 'range', min: '0', max: '250', step: '1', value: '0', 'aria-label': 'Latency nudge in milliseconds', oninput: e => { S.nudge = +e.target.value; nudgeOut.textContent = S.nudge + ' ms'; } });
    const bpmIn = h('input.ae__num.lp__bpm', { type: 'number', min: '40', max: '240', step: '1', value: String(S.bpm), 'aria-label': 'Tempo in beats per minute', onkeydown: e => e.stopPropagation(),
      onchange: e => { const v = Math.round(Number(e.target.value)); if (Number.isFinite(v) && v >= 40 && v <= 240) S.bpm = v; else say('Tempo must be between 40 and 240 BPM.', true); e.target.value = String(S.bpm); mk = null; } });
    const beatsSel = h('select.synth__sel', { 'aria-label': 'Beats per bar', onchange: e => { S.beats = Number(e.target.value); mk = null; } },
      [2, 3, 4, 5, 6, 7].map(n => h('option', { value: String(n), text: `${n} beats a bar`, selected: n === S.beats })));
    const swMetro = h('button.switch', { type: 'button', role: 'switch', 'aria-checked': 'false', 'aria-label': 'Metronome', onclick: () => toggleMetro() });
    const swCount = h('button.switch', { type: 'button', role: 'switch', 'aria-checked': 'false', 'aria-label': 'Count-in before the first take', onclick: () => { S.countIn = !S.countIn; paintTempo(); } });
    const bTrim = h('button.btn.btn--sm', { type: 'button', text: 'Trim to bars', onclick: trimToBars });
    const bBeats = h('button.btn.btn--sm', { type: 'button', onclick: beatsMenu }, icon('grid'), h('span', { text: 'Add a Beats loop' }));
    function toggleMetro() { S.metro = !S.metro; mk = null; paintTempo(); }
    function paintTempo() {
      swMetro.classList.toggle('is-on', S.metro); swMetro.setAttribute('aria-checked', String(S.metro));
      swCount.classList.toggle('is-on', S.countIn); swCount.setAttribute('aria-checked', String(S.countIn));
      bTrim.disabled = !S.len || (S.phase !== 'playing' && S.phase !== 'stopped');
      bBeats.disabled = !S.len || S.layers.length >= MAX_LAYERS;
    }
    const app = h('div.app.app--col.lp', { dataset: { phase: 'idle' } });
    const heads = [];

    function drawWave(cv, L) {
      const w = 320, hh = 40;
      cv.width = w; cv.height = hh;
      const g = cv.getContext('2d');
      const pk = W.peaks({ rate: ac.sampleRate, ch: [L.data] }, null, 0, L.data.length, w);
      g.fillStyle = getComputedStyle(cv).getPropertyValue('--ink-2') || '#aaa';
      for (let x = 0; x < w; x++) {
        const y0 = hh / 2 - Math.min(1, pk.hi[x]) * hh / 2, y1 = hh / 2 - Math.max(-1, pk.lo[x]) * hh / 2;
        g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
      }
    }
    function layerRow(L) {
      const cv = h('canvas.lp__cv', { 'aria-hidden': 'true' });
      const head = h('span.lp__head', { 'aria-hidden': 'true' });
      heads.push({ L, head });
      const volOut = h('span.mono.lp__volout', { text: Math.round(L.vol * 100) + '%' });
      const tog = (text, on, label, fn, cls) => h('button.btn.btn--sm.lp__tog' + (cls || ''), { type: 'button', text, 'aria-pressed': String(on), 'aria-label': label, dataset: { lbl: label.replace(L.name, '{n}') }, onclick: fn });
      const li = h('li.lp__layer', { dataset: { id: L.id } },
        h('div.lp__lrow',
          h('input.lp__lname', { type: 'text', value: L.name, maxlength: '24', 'aria-label': `Name of ${L.name}`, onkeydown: e => e.stopPropagation(), onchange: e => { L.name = e.target.value.trim().slice(0, 24) || L.name; e.target.value = L.name; e.target.closest('li').querySelectorAll('[data-lbl]').forEach(b => b.setAttribute('aria-label', b.dataset.lbl.replace('{n}', L.name))); } }),
          h('button.switch' + (L.muted ? '' : '.is-on'), { type: 'button', role: 'switch', 'aria-checked': String(!L.muted), 'aria-label': `${L.name} sound`, dataset: { lbl: '{n} sound' }, onclick: () => { L.muted = !L.muted; refreshGains(); paint(); } }),
          h('span.lp__state', { text: L.muted ? 'Muted' : (anySolo() && !L.solo ? 'Off (solo)' : 'On') }),
          tog('Solo', L.solo, `Solo ${L.name}`, () => { L.solo = !L.solo; refreshGains(); paint(); }, '.lp__solo'),
          h('button.ibtn', { type: 'button', 'aria-label': `Save ${L.name} as a file`, dataset: { lbl: 'Save {n} as a file' }, title: 'Save this layer', onclick: () => saveLayer(L) }, icon('download')),
          h('button.ibtn', { type: 'button', 'aria-label': `Remove ${L.name}`, dataset: { lbl: 'Remove {n}' }, onclick: () => removeLayer(L.id) }, icon('trash'))),
        h('div.lp__lrow',
          h('label.lp__vol', h('span', { text: 'Volume' }),
            h('input.slider', { type: 'range', min: '0', max: '100', step: '1', value: String(Math.round(L.vol * 100)), 'aria-label': `${L.name} volume`, dataset: { lbl: '{n} volume' }, oninput: e => { L.vol = Number(e.target.value) / 100; volOut.textContent = e.target.value + '%'; refreshGains(); } }), volOut),
          tog('Reverse', L.rev, `Reverse ${L.name}`, () => reverseLayer(L), '.lp__rev'),
          tog('Half speed', L.half, `${L.name} at half speed`, () => halfLayer(L), '.lp__half')),
        h('div.lp__wave', cv, head));
      drawWave(cv, L);
      return li;
    }

    function paint() {
      const rec = S.phase === 'first' || S.phase === 'over';
      pillRec.hidden = !rec; pillMic.hidden = !micIsOn();
      bRec.textContent = S.phase === 'first' ? 'Stop and loop' : (S.phase === 'armed' || S.phase === 'over' ? 'Cancel overdub' : S.phase === 'count' ? 'Cancel count-in' : 'Record loop');
      bRec.hidden = S.phase === 'playing' || S.phase === 'stopped';
      bOver.hidden = !S.len || S.phase === 'first' || S.phase === 'armed' || S.phase === 'over' || S.phase === 'count';
      bOver.disabled = S.layers.length >= MAX_LAYERS;
      bPlay.hidden = !S.len; bPlay.textContent = S.phase === 'stopped' ? 'Play' : 'Stop';
      bUndo.disabled = !S.layers.length; bClear.disabled = !S.len && !micIsOn();
      bSave.disabled = !S.layers.length; bMic.hidden = !micIsOn();
      app.dataset.phase = S.phase;
      heads.length = 0;
      list.replaceChildren(...S.layers.map(layerRow));
      paintTempo();
      const c = S.comp;
      lat.textContent = !c ? 'Delay compensation shows here once the microphone is on.'
        : c.known ? `Delay the browser reports: output ${c.out != null ? Math.round(c.out * 1000) + ' ms' : 'unknown'}, microphone ${c.inn != null ? Math.round(c.inn * 1000) + ' ms' : 'unknown'}. Overdubs are shifted earlier by this${S.nudge ? ' plus your nudge' : ''}.`
        : 'This browser does not report its audio delay, so overdubs are not shifted. Use Nudge if they sound late.';
    }
    app.append(
      h('div.app__bar', h('div.app__title', { text: 'Loop Station' }), h('div.grow'), pillRec, pillMic),
      h('div.lp__body',
        h('div.lp__warn', { role: 'note' }, icon('alert'), h('span', { text: 'Wear headphones. Without them the microphone hears the loop coming out of the speakers and it can build into a loud howl. Nothing you record leaves this tab.' })),
        h('div.lp__btns', bRec, bOver, bPlay, bUndo, bClear, bSave, bMic),
        bar, note,
        h('div.lp__tempo', { role: 'group', 'aria-label': 'Tempo' },
          h('label.ae__lab', h('span', { text: 'Tempo' }), bpmIn, h('span', { text: 'BPM' })), beatsSel,
          h('label.ae__lab', h('span', { text: 'Metronome' }), swMetro), h('label.ae__lab', h('span', { text: 'Count-in' }), swCount),
          bTrim, bBeats),
        list,
        h('div.lp__keys', { text: 'Keys: Space records, stops or overdubs · U undo · M metronome.' }),
        h('label.lp__nudge', h('span', { text: 'Nudge' }), nudge, nudgeOut), lat));
    root.appendChild(app);
    paint();

    const tick = setInterval(() => {
      if (!ac || !S.len) { barFill.style.width = '0%'; return; }
      const L = S.len / ac.sampleRate;
      const e = ac.currentTime - loopStart;
      barFill.style.width = S.phase === 'stopped' ? '0%' : ((e % L) / L * 100).toFixed(1) + '%';
      for (const { L: ly, head } of heads) {
        const r = ly.half ? 0.5 : 1;
        head.style.left = S.phase === 'stopped' ? '0%' : ((((e * r) % L) / L) * 100).toFixed(1) + '%';
      }
      if (S.phase === 'armed' && cap && cap.started) { S.phase = 'over'; paint(); }
    }, 60);
    const tickFirst = setInterval(() => {
      if (S.phase === 'count' && cap && cap.started) { S.phase = 'first'; say(''); paint(); }
      if (S.phase === 'first' && cap && ac && cap.total >= MAX_LOOP_S * ac.sampleRate) finishFirst();
    }, 100);
    const tickMetro = setInterval(metroTick, 25);

    /* keys: only for the active window, and never while typing in a box */
    const onKey = e => {
      if (!win.el.classList.contains('is-active')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = document.activeElement, tag = t && t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const k = e.key === ' ' ? ' ' : e.key.toLowerCase();
      if (k === ' ') {
        e.preventDefault(); if (e.repeat) return;
        if (S.phase === 'idle') recordFirst();
        else if (S.phase === 'stopped') togglePlay();
        else if (S.phase === 'playing') overdub();
        else stopPress();
      } else if (k === 'u') { e.preventDefault(); if (S.layers.length) undo(); }
      else if (k === 'm') { e.preventDefault(); toggleMetro(); }
    };
    const onKeyUp = e => { if (e.key === ' ' && win.el.classList.contains('is-active') && document.activeElement && document.activeElement.tagName === 'BUTTON') e.preventDefault(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);

    return () => {
      closed = true;
      clearInterval(tick); clearInterval(tickFirst); clearInterval(tickMetro);
      window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp);
      cap = null;
      stopAllPlay();
      micOff();
      if (ac) { try { ac.close(); } catch (e) { /* closing */ } ac = null; }
    };
  },
});
