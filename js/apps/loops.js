/* ============================================================
   loops.js — Loop Station

   Record a first loop from the microphone, then overdub layers that are
   locked to its length. Each layer can be muted or removed; Undo takes off
   the newest. "Save mix" writes a WAV into ~/Music. Everything stays in
   this tab: nothing is uploaded.

   Why its own app: Recorder makes single takes and edits them; a loop
   station keeps several layers sounding together on one clock, which is a
   different job from either Recorder or Beats.

   Microphone: asked for only when you press Record, shown by a red
   "Recording" pill and a "Microphone on" pill, and released by "Mic off",
   by Clear, and when the window closes.

   Timing: samples are read with a ScriptProcessor so the loop length is an
   exact sample count. An overdub starts at the next loop boundary and
   lasts exactly one loop. Speaker and mic delay make a layer land late, so
   it is shifted earlier by what the browser reports: AudioContext.
   outputLatency (or baseLatency) plus the mic track's settings.latency.
   When a browser reports neither, nothing is shifted and the screen says
   so; a Nudge control adds a manual offset on top.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import media from '../core/media.js';
import { encodeWav, mix, peakOf, rotate } from '../core/wavedit.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-audioplus-css')) {
  const l = document.createElement('link');
  l.id = 'feat-audioplus-css'; l.rel = 'stylesheet'; l.href = 'css/feat-audioplus.css';
  document.head.appendChild(l);
}
const MAX_LOOP_S = 60, MAX_LAYERS = 16;

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

  mount(ctx) {
    const { root, api } = ctx;
    const { h, icon } = api;
    const AC = window.AudioContext || window.webkitAudioContext;

    const S = { phase: 'idle', layers: [], len: 0, nudge: 0, comp: null, note: '' };
    let ac = null, stream = null, src = null, proc = null, sink = null, out = null;
    let loopStart = 0, nextId = 1, cap = null, hist = [];
    let closed = false;

    /* ---------- audio plumbing ---------- */
    async function openMic() {
      if (stream && stream.getTracks().some(t => t.readyState === 'live')) return true;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { say('This browser cannot reach a microphone.', true); return false; }
      if (!AC) { say('This browser has no Web Audio.', true); return false; }
      let st;
      try {
        st = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      } catch (e) {
        say(e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'The microphone was not allowed, so nothing can be recorded. Allow it in the address bar and try again.' : 'No microphone could be opened' + (e && e.message ? ': ' + e.message : '.'), true);
        return false;
      }
      if (closed) { st.getTracks().forEach(t => t.stop()); return false; }
      stream = st;
      if (!ac) { ac = new AC(); out = ac.createGain(); out.connect(ac.destination); }
      try { await ac.resume(); } catch (e) { /* stays suspended */ }
      src = ac.createMediaStreamSource(stream);
      proc = ac.createScriptProcessor(1024, 1, 1);
      sink = ac.createGain(); sink.gain.value = 0;               /* keeps the processor running without feeding the mic to the speakers */
      proc.onaudioprocess = onChunk;
      src.connect(proc); proc.connect(sink); sink.connect(ac.destination);
      latency();
      paint();
      return true;
    }
    function micOff() {
      if (proc) { proc.onaudioprocess = null; try { proc.disconnect(); } catch (e) { /* gone */ } proc = null; }
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

    function onChunk(e) {
      const d = e.inputBuffer.getChannelData(0);
      const tEnd = ac.currentTime, n = d.length;
      const chunk = { d: new Float32Array(d), t0: tEnd - n / ac.sampleRate };
      if (!cap) { hist.push(chunk); if (hist.length > 3) hist.shift(); return; }
      if (cap.kind === 'over' && !cap.started) {
        if (tEnd < cap.boundary) { hist.push(chunk); if (hist.length > 3) hist.shift(); return; }
        cap.started = true;
        /* begin exactly at the boundary, even if it fell inside an earlier chunk */
        const parts = [...hist.slice(-2), chunk];
        let skip = Math.max(0, Math.round((cap.boundary - parts[0].t0) * ac.sampleRate));
        cap.chunks = []; cap.total = 0;
        for (const p of parts) {
          const a = p.d;
          if (skip >= a.length) { skip -= a.length; continue; }
          const part = skip > 0 ? a.subarray(skip) : a; skip = 0;
          cap.chunks.push(part); cap.total += part.length;
        }
      } else { cap.chunks.push(chunk.d); cap.total += n; }
      if (cap.kind === 'over' && cap.total >= S.len) finishOver();
    }
    const join = (chunks, len) => { const o = new Float32Array(len); let p = 0; for (const c of chunks) { if (p >= len) break; const k = Math.min(c.length, len - p); o.set(c.subarray(0, k), p); p += k; } return o; };

    /* ---------- loop playback (one looping source per layer, all on one clock) ---------- */
    function playLayer(L) {
      stopLayer(L);
      const b = ac.createBuffer(1, L.data.length, ac.sampleRate);
      b.copyToChannel(L.data, 0);
      const s = ac.createBufferSource(); s.buffer = b; s.loop = true;
      const g = ac.createGain(); g.gain.value = L.muted ? 0 : 1;
      s.connect(g); g.connect(out);
      const len = S.len / ac.sampleRate;
      const pos = (((ac.currentTime - loopStart) % len) + len) % len;
      s.start(0, pos);
      L.node = s; L.gainNode = g;
    }
    function stopLayer(L) { if (L.node) { try { L.node.stop(); } catch (e) { /* stopped */ } try { L.node.disconnect(); L.gainNode.disconnect(); } catch (e) { /* gone */ } L.node = null; L.gainNode = null; } }
    function startAll() { loopStart = ac.currentTime; S.layers.forEach(playLayer); }
    function stopAllPlay() { S.layers.forEach(stopLayer); }

    /* ---------- actions ---------- */
    async function recordFirst() {
      if (!(await openMic())) return;
      S.phase = 'first'; cap = { kind: 'first', chunks: [], total: 0 };
      say(''); paint();
    }
    function finishFirst() {
      const c = cap; cap = null;
      const len = Math.min(c.total, MAX_LOOP_S * ac.sampleRate);
      if (len < ac.sampleRate * 0.2) { S.phase = 'idle'; say('That was too short for a loop. Press Record and play for at least a second.', true); paint(); return; }
      S.len = len;
      S.layers = [{ id: nextId++, name: 'Loop', data: join(c.chunks, len), muted: false }];
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
      S.layers.push({ id: nextId++, name: 'Layer ' + S.layers.length, data, muted: false });
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
      else if (S.phase === 'armed' || S.phase === 'over') { cap = null; S.phase = 'playing'; say('Overdub cancelled.'); paint(); }
    }
    function togglePlay() {
      if (!S.len) return;
      if (S.phase === 'stopped') { S.phase = 'playing'; startAll(); } else { stopAllPlay(); S.phase = 'stopped'; cap = null; }
      paint();
    }
    function undo() { const L = S.layers.pop(); if (L) stopLayer(L); if (!S.layers.length) reset(); else { say('Removed ' + L.name + '.'); paint(); } }
    function removeLayer(id) {
      const i = S.layers.findIndex(l => l.id === id); if (i < 0) return;
      const [L] = S.layers.splice(i, 1); stopLayer(L);
      if (!S.layers.length) reset(); else paint();
    }
    function reset() { stopAllPlay(); cap = null; S.layers = []; S.len = 0; S.phase = 'idle'; say(''); micOff(); paint(); }
    async function save() {
      if (!S.layers.length) return;
      const audible = S.layers.filter(l => !l.muted).map(l => ({ ch: [l.data] }));
      if (!audible.length) { say('Every layer is muted, so there is nothing to save.', true); return; }
      const m = mix(ac.sampleRate, S.len, audible, 1);
      const pk = peakOf(m);
      let scaled = false;
      if (pk > 0.98) { const f = 0.98 / pk; const d = m.ch[0]; for (let i = 0; i < d.length; i++) d[i] *= f; scaled = true; }
      try {
        const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
        const { path } = await media.save(api.vfs.HOME + '/Music', `Loop mix ${stamp}.wav`, new Blob([encodeWav(m)], { type: 'audio/wav' }));
        say(`Saved ${api.vfs.baseName(path)} to Music${scaled ? ' (turned down a little so the layers do not clip)' : ''}.`);
      } catch (e) { say('Could not save: ' + (e && e.message || e), true); }
      paint();
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
    const bMic = h('button.btn', { type: 'button', text: 'Mic off', onclick: () => { cap = null; if (S.phase === 'first' || S.phase === 'armed' || S.phase === 'over') S.phase = S.len ? 'playing' : 'idle'; micOff(); paint(); } });
    const barFill = h('div.lp__fill'), bar = h('div.lp__bar', barFill);
    const list = h('ul.lp__layers', { 'aria-label': 'Layers' });
    const lat = h('div.lp__lat');
    const nudgeOut = h('span.mono', { text: '0 ms' });
    const nudge = h('input.slider', { type: 'range', min: '0', max: '250', step: '1', value: '0', 'aria-label': 'Latency nudge in milliseconds', oninput: e => { S.nudge = +e.target.value; nudgeOut.textContent = S.nudge + ' ms'; } });
    const app = h('div.app.app--col.lp', { dataset: { phase: 'idle' } });

    function paint() {
      const rec = S.phase === 'first' || S.phase === 'over';
      pillRec.hidden = !rec; pillMic.hidden = !micIsOn();
      bRec.textContent = S.phase === 'first' ? 'Stop and loop' : (S.phase === 'armed' || S.phase === 'over' ? 'Cancel overdub' : 'Record loop');
      bRec.hidden = S.phase === 'playing' || S.phase === 'stopped';
      bOver.hidden = !S.len || S.phase === 'first' || S.phase === 'armed' || S.phase === 'over';
      bOver.disabled = S.layers.length >= MAX_LAYERS;
      bPlay.hidden = !S.len; bPlay.textContent = S.phase === 'stopped' ? 'Play' : 'Stop';
      bUndo.disabled = !S.layers.length; bClear.disabled = !S.len && !micIsOn();
      bSave.disabled = !S.layers.length; bMic.hidden = !micIsOn();
      app.dataset.phase = S.phase;
      list.replaceChildren(...S.layers.map(L => h('li.lp__layer', { dataset: { id: L.id } },
        h('span.lp__lname', { text: L.name }),
        h('button.switch' + (L.muted ? '' : '.is-on'), { type: 'button', role: 'switch', 'aria-checked': String(!L.muted), 'aria-label': `${L.name} sound`, onclick: () => { L.muted = !L.muted; if (L.gainNode) L.gainNode.gain.value = L.muted ? 0 : 1; paint(); } }),
        h('span.lp__state', { text: L.muted ? 'Muted' : 'On' }),
        h('button.ibtn', { type: 'button', 'aria-label': `Remove ${L.name}`, onclick: () => removeLayer(L.id) }, icon('trash')))));
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
        bar, note, list,
        h('label.lp__nudge', h('span', { text: 'Nudge' }), nudge, nudgeOut), lat));
    root.appendChild(app);
    paint();

    const tick = setInterval(() => {
      if (!ac || !S.len) { barFill.style.width = '0%'; return; }
      const L = S.len / ac.sampleRate;
      barFill.style.width = S.phase === 'stopped' ? '0%' : (((ac.currentTime - loopStart) % L) / L * 100).toFixed(1) + '%';
      if (S.phase === 'armed' && cap && cap.started) { S.phase = 'over'; paint(); }
    }, 60);
    const tickFirst = setInterval(() => { if (S.phase === 'first' && cap && ac && cap.total >= MAX_LOOP_S * ac.sampleRate) finishFirst(); }, 250);

    return () => {
      closed = true;
      clearInterval(tick); clearInterval(tickFirst);
      cap = null;
      stopAllPlay();
      micOff();
      if (ac) { try { ac.close(); } catch (e) { /* closing */ } ac = null; }
    };
  },
});
