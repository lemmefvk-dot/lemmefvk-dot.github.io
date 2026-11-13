/* ============================================================
   voicefx.js — voice effects for recordings. Pure audio, no DOM:
   Recorder wraps it in buttons, the tests call it directly.

   Every effect is rendered offline (OfflineAudioContext), so the
   result is exact, doesn't wait for the clock, and is the same
   buffer for the preview and for the saved file. The recording
   itself is only ever read.

     robot     ring modulation by a 50 Hz sine (the voice is multiplied
               by it, which splits every partial into a pair 50 Hz
               above and below), then a bitcrush: 6-bit samples held
               for 3 frames. Same length.
     chipmunk  pitch shift by RESAMPLING: the recording plays 1.6×
     deep      faster / 0.7× slower (+8.1 / −6.2 semitones). This is
               playback-rate shifting, not granular, so the speed
               changes with the pitch: chipmunk is shorter, deep is
               longer, and the voice's formants move with the pitch.
     echo      feedback delay: a copy 0.32 s later at 0.6, each repeat
               45% as loud as the one before, with room at the end
               for the repeats to die away.
     reverb    convolution with a generated impulse: 1.8 s of stereo
               noise that fades exponentially (a small hall), mixed
               under the dry voice. Nothing is downloaded.
     radio     band-pass, 500 Hz – 3.2 kHz (a small speaker), with
               make-up gain.

     decode(blob)                      -> Promise<AudioBuffer>
     render(buffer, id, opts?)         -> Promise<AudioBuffer>
     encodeWav(buffer)                 -> Blob   (16-bit PCM, mono or stereo)
     encodeOpus(buffer, { signal })    -> Promise<{ blob, mime }>
         Opus in WebM/Ogg through MediaRecorder, like Recorder's own
         takes. MediaRecorder only encodes live audio, so this plays
         the buffer once, in real time, into a MediaStream.
     canOpus()                         -> the MediaRecorder type it would use, or ''
     playBuffer(buffer, onEnd)         -> { stop() } preview through a normal AudioContext
   ============================================================ */

const OAC = typeof window !== 'undefined' ? (window.OfflineAudioContext || window.webkitOfflineAudioContext) : null;
const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;

export const EFFECTS = [
  { id: 'robot', label: 'Robot', icon: 'cpu', note: 'Ring modulation at 50 Hz plus a 6-bit bitcrush. Same length.' },
  { id: 'chipmunk', label: 'Chipmunk', icon: 'zap', note: 'Plays 1.6× faster (about 8 semitones up) — resampling, so it is shorter too.' },
  { id: 'deep', label: 'Deep', icon: 'volume-2', note: 'Plays 0.7× slower (about 6 semitones down) — resampling, so it is longer too.' },
  { id: 'echo', label: 'Echo', icon: 'repeat', note: 'A feedback delay: a copy every 0.32 s, each a bit quieter.' },
  { id: 'reverb', label: 'Reverb', icon: 'layers', note: 'A generated 1.8 s hall impulse mixed under your voice.' },
  { id: 'radio', label: 'Radio', icon: 'wifi', note: 'Band-pass 500 Hz – 3.2 kHz, like a small speaker.' },
];

export const DEFAULTS = {
  robot: { ringHz: 50, bits: 6, hold: 3 },
  chipmunk: { rate: 1.6 },
  deep: { rate: 0.7 },
  echo: { delay: 0.32, feedback: 0.45, wet: 0.6 },
  reverb: { seconds: 1.8, wet: 0.5, dry: 0.8 },
  radio: { low: 500, high: 3200, gain: 2 },
};

export const supported = () => !!OAC;
const MAX_CH = 2;
const clampN = (v, a, b) => Math.min(b, Math.max(a, v));

export async function decode(blob) {
  if (!OAC) throw new Error('This browser can’t process audio (no OfflineAudioContext).');
  const bytes = await blob.arrayBuffer();
  const ctx = new OAC(1, 1, 44100);
  return ctx.decodeAudioData(bytes);
}

/** A reproducible stereo room: decaying noise (exp(-t·k) reaches -60 dB at `seconds`). */
export function impulse(ctx, seconds, seed = 12345) {
  const sr = ctx.sampleRate;
  const n = Math.max(1, Math.round(seconds * sr));
  const buf = ctx.createBuffer(2, n, sr);
  let a = seed >>> 0;
  const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const k = Math.log(1000) / seconds;
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = (rnd() * 2 - 1) * Math.exp(-k * (i / sr));
  }
  return buf;
}

function bitcrush(buf, bits, hold) {
  const q = Math.pow(2, bits - 1);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    let held = 0;
    for (let i = 0; i < d.length; i++) {
      if (i % hold === 0) held = Math.round(d[i] * q) / q;
      d[i] = held;
    }
  }
}

/** Scale down (never up) so the loudest sample stays under about -0.4 dBFS. */
function guard(buf) {
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; }
  }
  if (peak <= 0.96) return buf;
  const g = 0.96 / peak;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] *= g;
  }
  return buf;
}

export async function render(input, id, opts = {}) {
  if (!OAC) throw new Error('This browser can’t process audio (no OfflineAudioContext).');
  if (!Object.hasOwn(DEFAULTS, id)) throw new Error(`Unknown effect “${id}”.`);
  const p = { ...DEFAULTS[id], ...opts };
  const ch = Math.min(MAX_CH, input.numberOfChannels);
  const sr = input.sampleRate;
  let seconds = input.duration;
  if (id === 'chipmunk' || id === 'deep') { p.rate = clampN(p.rate, 0.25, 4); seconds = input.duration / p.rate; }
  if (id === 'echo') seconds += p.delay * 7;
  if (id === 'reverb') seconds += p.seconds;
  const ctx = new OAC(ch, Math.max(1, Math.ceil(seconds * sr)), sr);
  const src = ctx.createBufferSource();
  src.buffer = input;
  const out = ctx.destination;

  if (id === 'robot') {
    const mod = ctx.createGain();
    mod.gain.value = 0;                           /* the oscillator alone sets the gain: out = in × sin */
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = p.ringHz;
    osc.connect(mod.gain);
    src.connect(mod).connect(out);
    osc.start(0);
  } else if (id === 'chipmunk' || id === 'deep') {
    src.playbackRate.value = p.rate;
    src.connect(out);
  } else if (id === 'echo') {
    const delay = ctx.createDelay(Math.max(1, p.delay + 0.1));
    delay.delayTime.value = p.delay;
    const fb = ctx.createGain();
    fb.gain.value = clampN(p.feedback, 0, 0.9);
    const wet = ctx.createGain();
    wet.gain.value = p.wet;
    src.connect(out);
    src.connect(delay);
    delay.connect(fb).connect(delay);
    delay.connect(wet).connect(out);
  } else if (id === 'reverb') {
    const conv = ctx.createConvolver();
    conv.buffer = impulse(ctx, p.seconds);
    const dry = ctx.createGain(), wet = ctx.createGain();
    dry.gain.value = p.dry;
    wet.gain.value = p.wet;
    src.connect(dry).connect(out);
    src.connect(conv).connect(wet).connect(out);
  } else if (id === 'radio') {
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = p.low; hp.Q.value = 0.7;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = p.high; lp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.value = p.gain;
    src.connect(hp).connect(lp).connect(g).connect(out);
  }
  src.start(0);
  const done = await ctx.startRendering();
  if (id === 'robot') bitcrush(done, p.bits, Math.max(1, Math.round(p.hold)));
  return guard(done);
}

export function encodeWav(buf) {
  const ch = Math.min(MAX_CH, buf.numberOfChannels);
  const n = buf.length;
  const rate = buf.sampleRate;
  const out = new ArrayBuffer(44 + n * ch * 2);
  const v = new DataView(out);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * ch * 2, true);
  const data = [];
  for (let c = 0; c < ch; c++) data.push(buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const s = clampN(data[c][i] || 0, -1, 1);
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([out], { type: 'audio/wav' });
}

const OPUS_TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus'];
export function canOpus() {
  if (!AC || typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
  return OPUS_TYPES.find(t => MediaRecorder.isTypeSupported(t)) || '';
}

export function encodeOpus(buf, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const type = canOpus();
    if (!type) { reject(new Error('This browser can’t encode Opus audio. Save as WAV instead.')); return; }
    let ctx;
    try { ctx = new AC({ sampleRate: buf.sampleRate }); } catch (e) { ctx = new AC(); }
    const dst = ctx.createMediaStreamDestination();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(dst);
    const rec = new MediaRecorder(dst.stream, { mimeType: type, audioBitsPerSecond: 96000 });
    const chunks = [];
    let settled = false, timer = 0;
    const finish = (err, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { src.disconnect(); } catch (e) { /* already gone */ }
      ctx.close().catch(() => {});
      if (err) reject(err); else resolve(val);
    };
    rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onerror = e => finish(e.error || new Error('The encoder failed.'));
    rec.onstop = () => {
      if (!chunks.length) finish(new Error('The encoder returned no audio.'));
      else finish(null, { blob: new Blob(chunks, { type }), mime: type });
    };
    const stopRec = () => { if (rec.state !== 'inactive') rec.stop(); };
    signal?.addEventListener('abort', () => { chunks.length = 0; finish(Object.assign(new Error('Cancelled.'), { code: 'abort' })); stopRec(); });
    /* plays in real time: allow the clip's length plus a margin, then say the audio clock isn't running */
    timer = setTimeout(() => { finish(new Error('The audio clock isn’t running in this browser, so the clip couldn’t be encoded. Save as WAV instead.')); stopRec(); }, buf.duration * 1000 + 6000);
    src.onended = () => setTimeout(stopRec, 120);
    ctx.resume().catch(() => {}).finally(() => { rec.start(250); src.start(); });
  });
}

let shared = null;
export function playBuffer(buf, onEnd) {
  if (!AC) { onEnd?.(new Error('no audio')); return { stop() {} }; }
  if (!shared || shared.state === 'closed') shared = new AC();
  const ctx = shared;
  ctx.resume().catch(() => {});
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  let over = false;
  const end = () => { if (over) return; over = true; try { src.disconnect(); } catch (e) { /* gone */ } onEnd?.(); };
  src.onended = end;
  src.start();
  return { stop() { try { src.stop(); } catch (e) { /* not started */ } end(); } };
}
