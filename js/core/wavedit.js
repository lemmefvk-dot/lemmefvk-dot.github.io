/* ============================================================
   wavedit.js — plain sample arithmetic for the Audio Editor and the
   Loop Station. No DOM, no AudioContext: everything takes and returns
   Float32Array channels, so it is exact and easy to test.

   A "clip" is { rate, ch: [Float32Array, …] } (all channels the same length).
   Editing functions never touch their input; they return a new clip, so
   undo is just keeping the older one.

   decodeWav(bytes)  reads PCM 8/16/24/32-bit and 32-bit float WAV exactly (no
                     resampling). Anything else is for decodeAudioData, which
                     resamples to the audio device's rate — the editor says so.
   encodeWav(clip)   16-bit PCM WAV bytes.
   pyramid / peaks   min/max summaries so a long file draws from a few
                     hundred numbers, not millions.
   ============================================================ */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const length = c => (c.ch[0] ? c.ch[0].length : 0);
export const seconds = c => length(c) / c.rate;
export const mono = (rate, data) => ({ rate, ch: [data] });

/* ---------- WAV in / out ---------- */
export function decodeWav(bytes) {
  const dv = new DataView(bytes instanceof ArrayBuffer ? bytes : bytes.buffer, bytes.byteOffset || 0, bytes.byteLength);
  const tag = (o, s) => { for (let i = 0; i < 4; i++) if (dv.getUint8(o + i) !== s.charCodeAt(i)) return false; return true; };
  if (dv.byteLength < 44 || !tag(0, 'RIFF') || !tag(8, 'WAVE')) return null;
  let fmt = null, dataAt = -1, dataLen = 0;
  for (let o = 12; o + 8 <= dv.byteLength;) {
    const size = dv.getUint32(o + 4, true);
    if (tag(o, 'fmt ') && size >= 16) {
      fmt = { code: dv.getUint16(o + 8, true), chans: dv.getUint16(o + 10, true), rate: dv.getUint32(o + 12, true), bits: dv.getUint16(o + 22, true) };
      if (fmt.code === 0xfffe && size >= 26) fmt.code = dv.getUint16(o + 32, true);     /* WAVE_FORMAT_EXTENSIBLE */
    } else if (tag(o, 'data')) {
      dataAt = o + 8; dataLen = Math.min(size, dv.byteLength - dataAt); break;
    }
    o += 8 + size + (size & 1);
  }
  if (!fmt || dataAt < 0 || !fmt.chans || !fmt.rate) return null;
  const { code, chans, bits } = fmt;
  const okFmt = (code === 1 && [8, 16, 24, 32].includes(bits)) || (code === 3 && bits === 32);
  if (!okFmt) return null;
  const bps = bits / 8, frames = Math.floor(dataLen / (bps * chans));
  const ch = Array.from({ length: chans }, () => new Float32Array(frames));
  let o = dataAt;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < chans; c++, o += bps) {
      let v;
      if (code === 3) v = dv.getFloat32(o, true);
      else if (bits === 16) v = dv.getInt16(o, true) / 32768;
      else if (bits === 8) v = (dv.getUint8(o) - 128) / 128;
      else if (bits === 24) v = ((dv.getUint8(o) | (dv.getUint8(o + 1) << 8) | (dv.getInt8(o + 2) << 16))) / 8388608;
      else v = dv.getInt32(o, true) / 2147483648;
      ch[c][i] = v;
    }
  }
  return { rate: fmt.rate, ch };
}

export function encodeWav(clip) {
  const chans = clip.ch.length, len = length(clip), rate = clip.rate;
  const bytes = 44 + len * chans * 2;
  const ab = new ArrayBuffer(bytes), dv = new DataView(ab);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); dv.setUint32(4, bytes - 8, true); ws(8, 'WAVE');
  ws(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, chans, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * chans * 2, true); dv.setUint16(32, chans * 2, true); dv.setUint16(34, 16, true);
  ws(36, 'data'); dv.setUint32(40, len * chans * 2, true);
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < chans; c++, o += 2) {
      const v = clamp(clip.ch[c][i], -1, 1);
      dv.setInt16(o, Math.round(v < 0 ? v * 32768 : v * 32767), true);
    }
  }
  return ab;
}

/* ---------- editing (each returns a new clip) ---------- */
const span = (c, from, to) => {
  const n = length(c);
  const a = clamp(Math.round(from), 0, n), b = clamp(Math.round(to), 0, n);
  return [Math.min(a, b), Math.max(a, b)];
};
const mapCh = (c, fn) => ({ rate: c.rate, ch: c.ch.map(fn) });

/** keep only [from, to) */
export function trim(c, from, to) { const [a, b] = span(c, from, to); return mapCh(c, d => d.slice(a, b)); }

/** delete [from, to) and close the gap */
export function cut(c, from, to) {
  const [a, b] = span(c, from, to);
  return mapCh(c, d => { const o = new Float32Array(d.length - (b - a)); o.set(d.subarray(0, a)); o.set(d.subarray(b), a); return o; });
}

/** multiply [from, to) by a ramp: 'in' goes 0 → 1, 'out' goes 1 → 0.
    shape 'linear' is a straight ramp; 'curve' is an S-curve (sin²) */
export function fade(c, from, to, dir, shape = 'linear') {
  const [a, b] = span(c, from, to), n = b - a;
  return mapCh(c, d => {
    const o = d.slice();
    for (let i = 0; i < n; i++) {
      /* the first sample of a fade-in is silent and the last of a fade-out is silent */
      let k = n > 1 ? i / (n - 1) : 1;
      if (shape === 'curve') k = Math.sin(k * Math.PI / 2) ** 2;
      o[a + i] *= dir === 'in' ? k : 1 - k;
    }
    return o;
  });
}

/** multiply [from, to) by a factor */
export function gain(c, from, to, factor) {
  const [a, b] = span(c, from, to);
  return mapCh(c, d => { const o = d.slice(); for (let i = a; i < b; i++) o[i] *= factor; return o; });
}
export const dbToGain = db => Math.pow(10, db / 20);
export const gainToDb = g => (g > 0 ? 20 * Math.log10(g) : -Infinity);

/** the biggest |sample| across every channel in [from, to) */
export function peakOf(c, from = 0, to = length(c)) {
  const [a, b] = span(c, from, to);
  let m = 0;
  for (const d of c.ch) for (let i = a; i < b; i++) { const v = d[i] < 0 ? -d[i] : d[i]; if (v > m) m = v; }
  return m;
}

/** scale [from, to) so its loudest sample reaches targetDb (dBFS). Silence is left alone. */
export function normalise(c, from, to, targetDb = -1) {
  const [a, b] = span(c, from, to);
  const pk = peakOf(c, a, b);
  if (pk <= 0) return { clip: c, factor: 1, changed: false };
  const factor = dbToGain(targetDb) / pk;
  return { clip: gain(c, a, b, factor), factor, changed: true };
}

/** sum clips (same rate) onto one timeline of `len` frames, each shifted by its own offset */
export function mix(rate, len, layers, chans = 1) {
  const out = Array.from({ length: chans }, () => new Float32Array(len));
  for (const L of layers) {
    const off = L.offset || 0, g = L.gain == null ? 1 : L.gain;
    for (let c = 0; c < chans; c++) {
      const src = L.ch[Math.min(c, L.ch.length - 1)];
      for (let i = 0; i < len; i++) {
        const j = i - off;
        if (j >= 0 && j < src.length) out[c][i] += src[j] * g;
      }
    }
  }
  return { rate, ch: out };
}

/* ---------- display ---------- */
const BLOCK = 256;
/** one min/max pair per 256 samples, merged across channels */
export function pyramid(c) {
  const n = length(c), m = Math.ceil(n / BLOCK);
  const lo = new Float32Array(m), hi = new Float32Array(m);
  for (let k = 0; k < m; k++) {
    let mn = Infinity, mx = -Infinity;
    const a = k * BLOCK, b = Math.min(n, a + BLOCK);
    for (const d of c.ch) for (let i = a; i < b; i++) { const v = d[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    lo[k] = mn === Infinity ? 0 : mn; hi[k] = mx === -Infinity ? 0 : mx;
  }
  return { lo, hi, n };
}

/** `bins` min/max pairs over [from, to). Uses the pyramid when each bin spans a few blocks. */
export function peaks(c, py, from, to, bins) {
  const [a, b] = span(c, from, to);
  const lo = new Float32Array(bins), hi = new Float32Array(bins);
  const per = (b - a) / bins;
  for (let k = 0; k < bins; k++) {
    const s = Math.floor(a + k * per), e = Math.max(s + 1, Math.floor(a + (k + 1) * per));
    let mn = Infinity, mx = -Infinity;
    if (py && per >= BLOCK * 2) {
      for (let q = Math.floor(s / BLOCK); q <= Math.min(py.lo.length - 1, Math.floor((e - 1) / BLOCK)); q++) {
        if (py.lo[q] < mn) mn = py.lo[q]; if (py.hi[q] > mx) mx = py.hi[q];
      }
    } else {
      for (const d of c.ch) for (let i = s; i < e && i < d.length; i++) { const v = d[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    }
    lo[k] = mn === Infinity ? 0 : mn; hi[k] = mx === -Infinity ? 0 : mx;
  }
  return { lo, hi };
}

/** circular shift left by n samples: out[i] = d[(i + n) mod len] (lines a late overdub back up) */
export function rotate(d, n) {
  const len = d.length;
  if (!len) return d.slice();
  const k = ((Math.round(n) % len) + len) % len, o = new Float32Array(len);
  o.set(d.subarray(k)); o.set(d.subarray(0, k), len - k);
  return o;
}

export default { rotate, decodeWav, encodeWav, trim, cut, fade, gain, normalise, peakOf, mix, pyramid, peaks, dbToGain, gainToDb, length, seconds };
