/* ============================================================
   drills/morse-core.js — International Morse code: the alphabet, the
   timing, how a sent key press is read, and the sound.

   Timing is the standard one, measured in units (ITU-R M.1677-1):
     dit = 1 unit      dah = 3 units
     gap inside a letter = 1      gap between letters = 3      between words = 7
   and the speed in words per minute is the "PARIS" one: the word PARIS
   is exactly 50 units long, so one unit lasts 1200 ÷ wpm milliseconds.

   Reading a key press (sending). A press shorter than 2 units is a dit,
   2 units or longer a dah: 2 is half-way between 1 and 3, so the same
   rule is right for a slightly fast or slow hand. The silence between
   presses is read the same way: under 2 units is the gap inside a
   letter, 2 up to 5 units a gap between letters, 5 or more a gap between
   words (5 is half-way between 3 and 7).

   Sound is WebAudio, from one oscillator whose gain is switched with
   short ramps so it does not click. stop() silences it at once and
   close() releases the audio context. Pure parts (the table, schedule,
   classify, decode) have no DOM or audio and are unit-tested.
   ============================================================ */

export const MORSE = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---', K: '-.-', L: '.-..', M: '--',
  N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
  0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.',
};
export const DECODE = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));

/* learning order: short and distinct first, then the longer ones, then the digits */
export const STAGES = [
  { id: 1, name: 'E T I A N M', chars: 'ETIANM', hint: 'The shortest letters: one or two signals.' },
  { id: 2, name: 'S U R W D K', chars: 'SURWDK', hint: 'Three signals, built on the first six.' },
  { id: 3, name: 'G O H V F L', chars: 'GOHVFL', hint: 'More three- and four-signal letters.' },
  { id: 4, name: 'P B X C Y Z Q J', chars: 'PBXCYZQJ', hint: 'The rest of the alphabet: the long and awkward ones.' },
  { id: 5, name: 'Numbers 1 to 5', chars: '12345', hint: 'Digits are always five signals: dits first, then dahs.' },
  { id: 6, name: 'Numbers 6 to 0', chars: '67890', hint: 'The same pattern turned around: dahs first, then dits.' },
];
export const ALL_CHARS = STAGES.map(s => s.chars).join('');

export const UNITS = { dit: 1, dah: 3, gapSymbol: 1, gapLetter: 3, gapWord: 7 };
export const WPM = { min: 5, max: 30, def: 12 };
export const FREQ = { min: 300, max: 1000, def: 600 };

/** One unit in milliseconds at this speed (PARIS: 50 units a word). */
export const unitMs = wpm => 1200 / wpm;

/** Text → "... --- ..." (letters apart by a space, words by " / "). Unknown characters are skipped. */
export function encode(text) {
  return String(text).toUpperCase().split(/\s+/).filter(Boolean)
    .map(w => [...w].filter(c => MORSE[c]).map(c => MORSE[c]).join(' ')).filter(Boolean).join(' / ');
}

/** Text → the key-down periods: [{ start, dur }] in units from 0, and the total length in units. */
export function schedule(text) {
  const on = [];
  let t = 0;
  const words = String(text).toUpperCase().split(/\s+/).filter(Boolean).map(w => [...w].filter(c => MORSE[c])).filter(w => w.length);
  words.forEach((w, wi) => {
    if (wi) t += UNITS.gapWord;
    w.forEach((c, ci) => {
      if (ci) t += UNITS.gapLetter;
      [...MORSE[c]].forEach((s, si) => {
        if (si) t += UNITS.gapSymbol;
        const dur = s === '.' ? UNITS.dit : UNITS.dah;
        on.push({ start: t, dur });
        t += dur;
      });
    });
  });
  return { on, total: t };
}

/** A key press of `ms` milliseconds: '.' or '-'. */
export const classifyPress = (ms, unit) => (ms < 2 * unit ? '.' : '-');
/** A silence of `ms` milliseconds: 'symbol' (inside a letter), 'letter' or 'word'. */
export const classifyGap = (ms, unit) => (ms < 2 * unit ? 'symbol' : ms < 5 * unit ? 'letter' : 'word');

/** Presses [{ down, up }] (ms timestamps) → { symbols: '.- -...' , text: 'AB' }. A pattern that is no
    character reads as '?'. */
export function decodePresses(presses, unit) {
  let sym = '';
  const letters = [];
  let word = '';
  const flush = () => { if (sym) { word += DECODE[sym] || '?'; sym = ''; } };
  presses.forEach((p, i) => {
    if (i) {
      const g = classifyGap(p.down - presses[i - 1].up, unit);
      if (g !== 'symbol') { flush(); if (g === 'word') { letters.push(word); word = ''; } }
    }
    sym += classifyPress(p.up - p.down, unit);
  });
  flush();
  letters.push(word);
  const text = letters.filter(w => w.length).join(' ');
  const symbols = presses.length ? presses.reduce((acc, p, i) => {
    const part = classifyPress(p.up - p.down, unit);
    if (!i) return part;
    const g = classifyGap(p.down - presses[i - 1].up, unit);
    return acc + (g === 'symbol' ? '' : g === 'letter' ? ' ' : ' / ') + part;
  }, '') : '';
  return { symbols, text };
}

/* ---------------- sound ---------------- */
const EDGE = 0.005;     /* seconds of ramp at each end of a tone */

/** A sidetone. `volume()` is read for each tone (0–1) so the system volume and Mute apply. */
export function createSidetone({ volume = () => 0.5, freq = () => FREQ.def, makeContext } = {}) {
  let ac = null, osc = null, gain = null, closed = false;
  const make = makeContext || (() => { const AC = globalThis.AudioContext || globalThis.webkitAudioContext; return AC ? new AC() : null; });
  function ensure() {
    if (closed) return false;
    if (!ac) {
      ac = make();
      if (!ac) return false;
      gain = ac.createGain();
      gain.gain.value = 0;
      gain.connect(ac.destination);
      osc = ac.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq();
      osc.connect(gain);
      osc.start();
    }
    if (ac.state === 'suspended' && typeof ac.resume === 'function') { try { ac.resume(); } catch (e) { /* needs a click first */ } }
    osc.frequency.value = freq();
    return true;
  }
  const level = () => Math.max(0, Math.min(1, volume())) * 0.3;
  return {
    available: () => !!(globalThis.AudioContext || globalThis.webkitAudioContext || makeContext),
    /** Start a tone now (a key held down). */
    on() {
      if (!ensure()) return;
      const t = ac.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(level(), t + EDGE);
    },
    off() {
      if (!ac || closed) return;
      const t = ac.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(0, t + EDGE);
    },
    /** Schedule a whole text from now; returns { total } in ms. */
    play(text, wpm) {
      const { on, total } = schedule(text);
      const u = unitMs(wpm) / 1000;
      if (!ensure()) return { total: total * unitMs(wpm) };
      const t0 = ac.currentTime + 0.06;
      const g = gain.gain;
      g.cancelScheduledValues(ac.currentTime);
      g.setValueAtTime(0, ac.currentTime);
      for (const s of on) {
        const a = t0 + s.start * u, b = a + s.dur * u;
        g.setValueAtTime(0, a);
        g.linearRampToValueAtTime(level(), a + EDGE);
        g.setValueAtTime(level(), b - EDGE);
        g.linearRampToValueAtTime(0, b);
      }
      return { total: total * unitMs(wpm), lead: 60 };
    },
    /** Silence at once; the audio context stays for the next sound. */
    stop() {
      if (!ac || closed) return;
      const t = ac.currentTime;
      try { gain.gain.cancelScheduledValues(t); gain.gain.setValueAtTime(0, t); } catch (e) { /* fine */ }
    },
    /** Silence and release everything. The sidetone is not usable afterwards. */
    close() {
      closed = true;
      if (!ac) return;
      try { gain.gain.cancelScheduledValues(0); gain.gain.value = 0; } catch (e) { /* fine */ }
      try { osc.stop(); } catch (e) { /* fine */ }
      try { osc.disconnect(); gain.disconnect(); } catch (e) { /* fine */ }
      try { ac.close(); } catch (e) { /* fine */ }
      ac = osc = gain = null;
    },
  };
}
