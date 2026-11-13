/* ============================================================
   pitch.js — find the pitch of a sound, name the note, and say
   how far off it is. Pure functions, no DOM, no microphone, so
   the tuner in Music and the tests can feed them any samples.

     yin(samples, sampleRate, opts?)  -> { freq, clarity } | null
         The YIN estimator (de Cheveigné & Kawahara, 2002):
         difference function, cumulative mean normalisation, the
         first dip under a threshold, parabolic interpolation.
         It needs at least 2 × (sampleRate / minHz) samples; 4096
         at 44.1 / 48 kHz covers anything down to 50 Hz.
         null when nothing in the sound repeats (noise, silence).
     rms(samples)                     -> 0..1 loudness
     noteOf(freq, a4 = 440)           -> { midi, name, octave, label, cents, freq }
         the nearest equal-tempered note and how many cents (1/100
         of a semitone) the sound is above (+) or below (−) it
     TUNINGS                          standard guitar, drop D, ukulele
     targetOf(freq, tuning)           -> the closest string and its cents
     makeSmoother()                   -> { push(reading|null), reset() }
         steadies a stream of readings: a median of the last few,
         dropped to nothing only after a run of silent frames
   ============================================================ */

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const hz = (midi, a4 = 440) => a4 * Math.pow(2, (midi - 69) / 12);
const midiOf = (f, a4 = 440) => 69 + 12 * Math.log2(f / a4);

export function rms(x) {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, x.length));
}

export function yin(x, sr, { minHz = 50, maxHz = 1400, threshold = 0.15, floor = 0.45 } = {}) {
  const W = Math.floor(x.length / 2);
  const tauMax = Math.min(W - 2, Math.floor(sr / minHz));
  const tauMin = Math.max(2, Math.floor(sr / maxHz));
  if (tauMax <= tauMin + 2) return null;
  const d = new Float32Array(tauMax + 2);
  for (let tau = 1; tau <= tauMax + 1; tau++) {
    let s = 0;
    for (let i = 0; i < W; i++) { const v = x[i] - x[i + tau]; s += v * v; }
    d[tau] = s;
  }
  /* cumulative mean normalised difference */
  const n = new Float32Array(tauMax + 2);
  n[0] = 1;
  let run = 0;
  for (let tau = 1; tau <= tauMax + 1; tau++) {
    run += d[tau];
    n[tau] = run > 0 ? d[tau] * tau / run : 1;
  }
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (n[t] < threshold) {
      while (t + 1 <= tauMax && n[t + 1] < n[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) {                                  /* no clear dip: take the deepest, if it is deep enough */
    let best = tauMin;
    for (let t = tauMin; t <= tauMax; t++) if (n[t] < n[best]) best = t;
    if (n[best] > floor) return null;
    tau = best;
  }
  /* parabolic interpolation around the dip for sub-sample accuracy */
  let t0 = tau;
  if (tau > 1 && tau < tauMax + 1) {
    const a = n[tau - 1], b = n[tau], c = n[tau + 1];
    const den = a - 2 * b + c;
    if (den !== 0) t0 = tau + (a - c) / (2 * den);
  }
  return { freq: sr / t0, clarity: Math.max(0, Math.min(1, 1 - n[tau])) };
}

export function noteOf(freq, a4 = 440) {
  if (!(freq > 0)) return null;
  const m = midiOf(freq, a4);
  const midi = Math.round(m);
  const name = NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return { midi, name, octave, label: `${name}${octave}`, cents: (m - midi) * 100, freq };
}

const str = (name, midi) => ({ name, midi, label: `${name}${Math.floor(midi / 12) - 1}`, freq: hz(midi) });
/* strings in the order they are played, low to high (the ukulele's G is the high one) */
export const TUNINGS = {
  guitar: { id: 'guitar', label: 'Guitar', sub: 'E A D G B E', strings: [str('E', 40), str('A', 45), str('D', 50), str('G', 55), str('B', 59), str('E', 64)] },
  dropd: { id: 'dropd', label: 'Drop D', sub: 'D A D G B E', strings: [str('D', 38), str('A', 45), str('D', 50), str('G', 55), str('B', 59), str('E', 64)] },
  ukulele: { id: 'ukulele', label: 'Ukulele', sub: 'G C E A', strings: [str('G', 67), str('C', 60), str('E', 64), str('A', 69)] },
};

/** The string a sound is closest to (in pitch, not in Hz) and its cents off that string. */
export function targetOf(freq, tuning) {
  const t = TUNINGS[tuning];
  if (!t || !(freq > 0)) return null;
  const m = midiOf(freq);
  let best = 0;
  t.strings.forEach((s, i) => { if (Math.abs(s.midi - m) < Math.abs(t.strings[best].midi - m)) best = i; });
  const s = t.strings[best];
  return { index: best, string: s, cents: (m - s.midi) * 100 };
}

export function makeSmoother({ size = 5, hold = 8, jump = 0.8 } = {}) {
  let win = [], quiet = 0;
  const median = a => { const s = [...a].sort((p, q) => p - q); return s[s.length >> 1]; };
  return {
    reset() { win = []; quiet = 0; },
    /** reading: { freq } or null for a silent / unclear frame. Returns { freq } or null. */
    push(reading) {
      if (!reading || !(reading.freq > 0)) {
        if (++quiet > hold) win = [];
        return win.length ? { freq: hz(median(win)) } : null;
      }
      quiet = 0;
      const m = midiOf(reading.freq);
      if (win.length && Math.abs(m - median(win)) > jump) win = [];   /* a new note: don't average across it */
      win.push(m);
      if (win.length > size) win.shift();
      return { freq: hz(median(win)) };
    },
  };
}
