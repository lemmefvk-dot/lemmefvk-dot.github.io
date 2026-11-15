/* ============================================================
   beatsrender.js — draw a Static Beats pattern into samples.

   Uses Beats' own synthesised voices and scheduling helpers (js/apps/beats.js
   exports them read-only), played into an OfflineAudioContext, so a pattern
   sounds the same here as in Beats' own export.

   renderPattern(pattern, seconds, rate)  one mono Float32Array exactly
       round(seconds * rate) long: the pattern's bar repeats until the time
       is full. A hit's tail that runs past the end wraps onto the start, so
       the result loops cleanly.
   renderVoice(id, rate)                  one hit of one instrument.
   instrumentsOf(pattern)                 the instruments the pattern uses.
   ============================================================ */
import { createSynth } from './synth.js';

const Offline = () => window.OfflineAudioContext || window.webkitOfflineAudioContext;

function bus(oac) {
  const comp = oac.createDynamicsCompressor();
  comp.threshold.value = -6; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.14;
  const master = oac.createGain(); master.gain.value = 0.8;
  master.connect(comp).connect(oac.destination);
  return master;
}

export async function renderPattern(pattern, seconds, rate = 44100) {
  const O = Offline();
  if (!O) throw new Error('This browser has no OfflineAudioContext to render with.');
  const B = await import('../apps/beats.js');
  const n = Math.max(1, Math.round(seconds * rate)), tail = Math.round(rate * 0.6);
  const p = { ...pattern, id: 'render' };
  const barDur = B.songPlan([{ pat: 'render', times: 1 }], [p]).total;
  const plan = B.songPlan([{ pat: 'render', times: Math.max(1, Math.ceil(seconds / barDur)) }], [p]);
  const oac = new O(1, n + tail, rate);
  const master = bus(oac), nb = B.makeNoise(oac);
  /* the melody row plays on Beats' own synth, made only when the pattern has notes */
  let syn = null;
  const melOf = () => syn || (syn = createSynth(oac, { patch: B.melPatch(B.normPattern(p).mel.patch), destination: master, offline: true, maxVoices: 2048 }));
  let hits = 0;
  /* bar.len is the pattern's own step count (8 to 32); each hit carries its row's pitch and decay */
  for (const bar of plan.bars) for (let s = 0; s < bar.len; s++) {
    for (const hit of B.stepHits(bar, s)) { if (hit.t < seconds) { B.VOICES[hit.id](oac, hit.t, master, nb, hit.v, hit.x); hits++; } }
    const at = bar.start + s * bar.sd;
    if (bar.snap.mel.notes.length && at < seconds) B.stepMelody(melOf(), bar, s, at);
  }
  const d = (await oac.startRendering()).getChannelData(0);
  const out = d.slice(0, n);
  for (let i = 0; i < tail && i < n; i++) out[i] += d[n + i];
  return { data: out, hits, barSeconds: barDur, bpm: B.normPattern(p).bpm };
}

export async function renderVoice(id, rate = 44100, seconds = 0.8) {
  const O = Offline();
  if (!O) throw new Error('This browser has no OfflineAudioContext to render with.');
  const B = await import('../apps/beats.js');
  const inst = B.INSTRUMENTS.find(i => i.id === id);
  if (!inst) throw new Error('Unknown instrument ' + id);
  const oac = new O(1, Math.round(seconds * rate), rate);
  B.VOICES[id](oac, 0.005, bus(oac), B.makeNoise(oac), inst.peak);
  return (await oac.startRendering()).getChannelData(0).slice();
}

export async function instrumentsOf(pattern) {
  const B = await import('../apps/beats.js');
  const p = B.normPattern(pattern);
  return B.INSTRUMENTS.filter(i => p.steps[i.id].some(Boolean) && !p.mutes[i.id]).map(i => ({ id: i.id, name: i.name }));
}

export default { renderPattern, renderVoice, instrumentsOf };
