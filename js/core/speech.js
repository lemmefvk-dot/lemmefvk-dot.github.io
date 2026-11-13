/* ============================================================
   speech.js — read aloud, with the browser's own voices.

   The Web Speech API's speechSynthesis does the speaking; StaticOS
   only decides what to say and when. Text is split into sentences
   (Intl.Segmenter where the browser has it, punctuation otherwise;
   a very long sentence is cut at a comma or a space) and each one is
   its own utterance, spoken when the last one ends. That way:
     · the sentence being read is always known (each utterance's
       'start'), so the player can highlight it on every browser;
     · the word being read is known too where the browser sends
       'boundary' events (most local voices do; many network voices
       don't) — `boundary` in state() says whether it has this time;
     · a new speed, pitch, voice or volume applies from the next
       sentence, and no single utterance runs long enough to hit the
       cut-off some browsers have for long ones.

   Settings (prefs, Settings › Accessibility › Read aloud):
     readVoice   a voice's voiceURI ('' = the browser's default)
     readRate    0.5–2 (1)
     readPitch   0–2 (1)
   Loudness follows the OS volume and Mute (prefs.volume / prefs.muted).

   Where speechSynthesis is missing, or the browser has it but no
   voices, nothing pretends: state().error says so in plain words.

     supported()  voices()  whenVoices(ms) → Promise<voices[]>
     settings()   sentences(text)
     speak(text)  pause()  resume()  toggle()  stop()  from(i)
     state()      { supported, status, parts, index, word, boundary, error, muted }
   status: idle | speaking | paused | done | error
   bus 'speech:change' with state() after anything changes.
   ============================================================ */
import { bus } from './bus.js';
import { store } from './store.js';

export const RATE = { min: 0.5, max: 2, step: 0.1, def: 1 };
export const PITCH = { min: 0, max: 2, step: 0.1, def: 1 };
const MAX_CHUNK = 240;            /* characters in one utterance, at most */
const MAX_TEXT = 30000;           /* a selection longer than this is cut */

export const MISSING = 'This browser can’t read aloud: it has no speech synthesis (the Web Speech API). Desktop Chrome, Edge, Safari and Firefox have it.';
export const NO_VOICES = 'This browser has speech synthesis but no voices to speak with. Voices come from the computer — on Windows and macOS they are in the system’s speech settings; on Linux, install speech-dispatcher with a voice.';

const synth = () => (typeof window !== 'undefined' && window.speechSynthesis && typeof window.speechSynthesis.speak === 'function'
  ? window.speechSynthesis : null);
const Utter = () => (typeof window !== 'undefined' && typeof window.SpeechSynthesisUtterance === 'function'
  ? window.SpeechSynthesisUtterance : null);
export const supported = () => !!(synth() && Utter());

/* ---------------- voices ----------------------------------------- */
let known = [];
let wired = false;
export function voices() {
  const s = synth();
  if (!s) return [];
  try { const v = s.getVoices(); if (v && v.length) known = [...v]; } catch (e) { /* keep what we had */ }
  wire();
  return known;
}
function wire() {
  const s = synth();
  if (wired || !s) return;
  wired = true;
  const on = () => { voices(); bus.emit('speech:voices', known); emit(); };
  try {
    if (typeof s.addEventListener === 'function') s.addEventListener('voiceschanged', on);
    else s.onvoiceschanged = on;
  } catch (e) { /* no event: the list is read each time */ }
}
/** The voice list, waiting up to `ms` for a browser that loads it late. */
export function whenVoices(ms = 1500) {
  if (!supported()) return Promise.resolve([]);
  if (voices().length) return Promise.resolve(known);
  return new Promise(resolve => {
    const done = () => { clearTimeout(t); off(); resolve(voices()); };
    const off = bus.on('speech:voices', done);
    const t = setTimeout(done, ms);
  });
}

/* ---------------- settings --------------------------------------- */
const step = (v, { min, max, def }) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(Math.max(min, Math.min(max, n)) * 100) / 100 : def;
};
export function settings() {
  return {
    voice: String(store.get('prefs.readVoice') || ''),
    rate: step(store.get('prefs.readRate'), RATE),
    pitch: step(store.get('prefs.readPitch'), PITCH),
  };
}
function pickVoice(uri) {
  if (!uri) return null;
  return voices().find(v => v.voiceURI === uri) || voices().find(v => v.name === uri) || null;
}
const muted = () => store.get('prefs.muted', false) === true;
const loudness = () => {
  if (muted()) return 0;
  const v = Number(store.get('prefs.volume', 62));
  return Math.max(0, Math.min(100, Number.isFinite(v) ? v : 62)) / 100;
};

/* ---------------- sentences -------------------------------------- */
function splitLong(s) {
  const out = [];
  let rest = s;
  while (rest.length > MAX_CHUNK) {
    let cut = Math.max(rest.lastIndexOf(', ', MAX_CHUNK), rest.lastIndexOf('; ', MAX_CHUNK), rest.lastIndexOf(': ', MAX_CHUNK), rest.lastIndexOf(' – ', MAX_CHUNK));
    if (cut < MAX_CHUNK * 0.4) cut = rest.lastIndexOf(' ', MAX_CHUNK);
    if (cut < 20) cut = MAX_CHUNK - 1;
    out.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** Text → the sentences it is read in. Line breaks end a sentence too. */
export function sentences(text) {
  const t = String(text || '').slice(0, MAX_TEXT);
  let seg = null;
  try { seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'sentence' }) : null; } catch (e) { seg = null; }
  const out = [];
  for (const line of t.split(/\n+/)) {
    const para = line.replace(/\s+/g, ' ').trim();
    if (!para) continue;
    const parts = seg ? [...seg.segment(para)].map(x => x.segment)
      : (para.match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)\s*/g) || [para]);
    for (const p of parts) {
      const s = p.trim();
      if (!s) continue;
      out.push(...(s.length > MAX_CHUNK ? splitLong(s) : [s]));
    }
  }
  return out;
}

/* ---------------- reading ---------------------------------------- */
const R = { status: 'idle', parts: [], index: -1, word: null, boundary: false, error: null, token: 0, utter: null, started: false, opts: null };

export function state() {
  return {
    supported: supported(),
    status: R.status,
    parts: R.parts.slice(),
    index: R.index,
    word: R.word ? { ...R.word } : null,
    boundary: R.boundary,
    error: R.error,
    muted: muted(),
  };
}
const emit = () => bus.emit('speech:change', state());

const ERRORS = {
  'not-allowed': 'The browser didn’t let reading start on its own. Press Play to start it.',
  'audio-busy': 'The sound output is busy with something else.',
  'audio-hardware': 'The browser found no sound output to read through.',
  network: 'This voice needs the internet and couldn’t reach it. Pick another voice in Settings › Accessibility.',
  'synthesis-unavailable': 'The browser’s speech engine isn’t available right now.',
  'synthesis-failed': 'The browser’s speech engine failed on this text. Another voice may work.',
  'language-unavailable': 'There’s no voice for this language here. Pick another voice in Settings › Accessibility.',
  'voice-unavailable': 'That voice isn’t available any more. Pick another in Settings › Accessibility.',
  'text-too-long': 'That piece of text was too long for the browser’s speech engine.',
};

function wordAt(text, i) {
  const m = /^[^\s]+/.exec(text.slice(i));
  return m ? m[0].length : 0;
}

function say(tok) {
  if (tok !== R.token) return;
  const s = synth(), U = Utter();
  if (R.index >= R.parts.length) {
    R.status = 'done';
    R.word = null;
    R.utter = null;
    emit();
    return;
  }
  const text = R.parts[R.index];
  const u = new U(text);
  const cfg = settings();
  const o = R.opts;
  u.rate = o && o.rate ? Math.max(RATE.min, Math.min(RATE.max, o.rate)) : cfg.rate;
  u.pitch = cfg.pitch;
  u.volume = loudness();
  let v = pickVoice((o && o.voice) || cfg.voice);
  if (!v && o && o.lang) { const L = o.lang.toLowerCase(); v = voices().find(x => x.lang && x.lang.toLowerCase().startsWith(L)) || null; }
  if (v) { u.voice = v; if (v.lang) u.lang = v.lang; }
  u.onstart = () => {
    if (tok !== R.token) return;
    R.started = true;
    R.word = null;
    emit();
  };
  u.onboundary = e => {
    if (tok !== R.token || (e.name && e.name !== 'word')) return;
    const at = Number(e.charIndex);
    if (!Number.isFinite(at) || at < 0 || at >= text.length) return;
    R.boundary = true;
    R.word = { start: at, len: Number(e.charLength) > 0 ? Number(e.charLength) : wordAt(text, at) };
    emit();
  };
  u.onend = () => {
    if (tok !== R.token) return;
    R.index++;
    R.word = null;
    say(tok);
  };
  u.onerror = e => {
    if (tok !== R.token) return;
    const code = e && e.error;
    if (code === 'interrupted' || code === 'canceled') return;   /* our own stop() */
    R.token++;
    R.status = 'error';
    R.error = ERRORS[code] || `Reading stopped: the browser said “${code || 'error'}”.`;
    R.word = null;
    emit();
  };
  R.utter = u;     /* held here: an utterance nobody references can lose its events */
  try { s.speak(u); } catch (err) {
    R.token++;
    R.status = 'error';
    R.error = 'The browser refused to speak this text.';
    emit();
  }
}

/**
 * Read `text` aloud from the start, replacing whatever was being read.
 * `o` (optional) picks how this one text is spoken: { voice: a voiceURI,
 * lang: 'es' (any voice of that language, if no voice is given), rate }.
 * Without it the Settings voice and speed are used, as for read aloud.
 */
export function speak(text, o) {
  cancel();
  R.opts = o && typeof o === 'object' ? { voice: String(o.voice || ''), lang: String(o.lang || ''), rate: Number(o.rate) || 0 } : null;
  R.error = null;
  R.parts = sentences(text);
  R.index = 0;
  R.word = null;
  R.boundary = false;
  R.started = false;
  if (!supported()) { R.status = 'error'; R.error = MISSING; emit(); return false; }
  if (!R.parts.length) { R.status = 'error'; R.error = 'There’s no text in the selection to read.'; emit(); return false; }
  return go(0);
}

function go(i) {
  const s = synth();
  R.index = Math.max(0, Math.min(R.parts.length - 1, i));
  R.status = 'speaking';
  R.error = null;
  R.word = null;
  const tok = ++R.token;
  try { if (s.paused) s.resume(); } catch (e) { /* fine */ }
  emit();
  say(tok);
  /* a browser with the API but no voices never starts: say so rather than sit there */
  if (!voices().length) {
    whenVoices(1500).then(list => {
      if (tok !== R.token || R.started || list.length) return;
      cancel();
      R.status = 'error';
      R.error = NO_VOICES;
      emit();
    });
  }
  return true;
}

/** Start again from sentence i of what was last read. */
export function from(i) {
  if (!supported() || !R.parts.length) return false;
  cancel();
  return go(i);
}

export function pause() {
  const s = synth();
  if (!s || R.status !== 'speaking') return;
  try { s.pause(); } catch (e) { /* fine */ }
  R.status = 'paused';
  emit();
}
export function resume() {
  const s = synth();
  if (!s || R.status !== 'paused') return;
  try { s.resume(); } catch (e) { /* fine */ }
  R.status = 'speaking';
  emit();
}
/** Play / pause: from the start again once it is done. */
export function toggle() {
  if (R.status === 'speaking') pause();
  else if (R.status === 'paused') resume();
  else if (R.parts.length && supported()) from(R.status === 'done' ? 0 : Math.max(0, R.index));
}

function cancel() {
  R.token++;
  R.utter = null;
  const s = synth();
  if (s) { try { s.cancel(); } catch (e) { /* fine */ } }
}

/** Stop reading. What was read stays, so Play reads it again. */
export function stop() {
  const was = R.status;
  cancel();
  R.word = null;
  if (was === 'speaking' || was === 'paused') { R.status = 'idle'; R.index = 0; }
  emit();
}

/** Forget it all (the player was closed). */
export function clear() {
  cancel();
  R.status = 'idle';
  R.parts = [];
  R.index = -1;
  R.word = null;
  R.error = null;
  R.opts = null;
  emit();
}

export default { RATE, PITCH, MISSING, NO_VOICES, supported, voices, whenVoices, settings, sentences, speak, pause, resume, toggle, stop, from, clear, state };
