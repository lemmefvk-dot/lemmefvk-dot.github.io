/* ============================================================
   playerfx.js — what Music does to the sound of the one OS player:
   the equalizer, playback speed and crossfade length.

   THE GRAPH
   core/audiotap.js reads the player without touching its sound
   (captureStream), so it adds no nodes. An equalizer has to be IN the
   sound, so it is the one thing here that routes the element through
   Web Audio:

        <audio> → MediaElementSource → preamp → 10 peaking filters → out

   · The graph is built only when the person turns the equalizer on, so
     nobody who never opens it has their sound re-routed.
   · A browser only lets a page process audio it is allowed to read. A
     song is a blob: of this origin, always fine. A station is fine when
     it came through one of SomaFM's CORS servers; through the plain
     fallback the browser would hand the graph silence, so the equalizer
     stays out of the way (status() says why) rather than muting it. For
     the same reason the graph is never built until the AudioContext
     runs: a context that the browser has not yet allowed would be a mute
     button.
   · Once an element is wired in it stays wired (the browser has no way
     to undo it), so "off" is the same graph set flat (every band 0 dB).
   · The element's own volume (the OS volume, the mixer's Music level,
     the sleep timer's fade) still applies, so those keep working.

   EQ(): state { on, preset, gains[10] } saved as prefs.musicEq.
   speed()/setSpeed(), crossfade()/setCrossfade() are saved prefs too.
   ============================================================ */
import { store } from './store.js';
import { bus } from './bus.js';

export const BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const BAND_LABELS = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
export const RANGE = 12;                         /* dB either way */

/* each preset is a curve over the ten bands, in dB */
export const PRESETS = [
  { id: 'flat', name: 'Flat', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: 'bass', name: 'Bass boost', gains: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0] },
  { id: 'less-bass', name: 'Less bass', gains: [-6, -5, -4, -2, 0, 0, 0, 0, 0, 0] },
  { id: 'treble', name: 'Treble boost', gains: [0, 0, 0, 0, 0, 1, 3, 5, 6, 6] },
  { id: 'vocal', name: 'Vocal', gains: [-3, -2, -1, 1, 3, 4, 3, 1, 0, -1] },
  { id: 'rock', name: 'Rock', gains: [5, 4, 2, -1, -2, -1, 2, 4, 5, 5] },
  { id: 'pop', name: 'Pop', gains: [-1, 1, 3, 4, 3, 1, -1, -1, 1, 2] },
  { id: 'classical', name: 'Classical', gains: [4, 3, 2, 1, -1, -1, 0, 2, 3, 4] },
  { id: 'electronic', name: 'Electronic', gains: [5, 4, 1, 0, -2, 2, 1, 2, 4, 5] },
  { id: 'late', name: 'Late night', gains: [-4, -3, -1, 0, 1, 2, 1, 0, -3, -5] },
];
const KEY = 'prefs.musicEq';
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const presetById = id => PRESETS.find(p => p.id === id) || null;

/* ---------------- the saved equalizer ---------------- */
export function EQ() {
  const o = store.get(KEY);
  const raw = o && typeof o === 'object' ? o : {};
  const base = presetById(raw.preset);
  const gains = BANDS.map((_, i) => {
    const g = Array.isArray(raw.gains) ? Number(raw.gains[i]) : NaN;
    return Number.isFinite(g) ? clamp(Math.round(g * 2) / 2, -RANGE, RANGE) : (base ? base.gains[i] : 0);
  });
  /* a preset id only counts while the curve is still that preset's */
  const hit = PRESETS.find(p => p.gains.every((g, i) => g === gains[i]));
  return { on: raw.on === true, preset: hit ? hit.id : 'custom', gains };
}
function saveEq(next) {
  store.set(KEY, { v: 1, on: !!next.on, preset: next.preset, gains: next.gains });
  apply();
  bus.emit('playerfx:change', 'eq');
}
export function setEqOn(on) {
  const e = EQ();
  saveEq({ ...e, on: !!on });
  if (on) tryRoute();
}
export function setPreset(id) {
  const p = presetById(id);
  if (!p) return;
  saveEq({ on: true, preset: p.id, gains: p.gains.slice() });
  tryRoute();
}
export function setGain(i, db) {
  if (!(i >= 0 && i < BANDS.length)) return;
  const e = EQ();
  const gains = e.gains.slice();
  gains[i] = clamp(Math.round(Number(db) * 2) / 2 || 0, -RANGE, RANGE);
  saveEq({ on: true, preset: 'custom', gains });
  tryRoute();
}
export function resetEq() { saveEq({ on: false, preset: 'flat', gains: PRESETS[0].gains.slice() }); }

/* ---------------- speed and crossfade ---------------- */
export const SPEEDS = [0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
export const speed = () => { const v = Number(store.get('prefs.musicSpeed', 1)); return Number.isFinite(v) ? clamp(Math.round(v * 100) / 100, 0.75, 2) : 1; };
export function setSpeed(v) { store.set('prefs.musicSpeed', clamp(Math.round(Number(v) * 100) / 100 || 1, 0.75, 2)); bus.emit('playerfx:change', 'speed'); }
export const XFADE_MAX = 12;
export const crossfade = () => { const v = Number(store.get('prefs.musicCrossfade', 0)); return Number.isFinite(v) ? clamp(Math.round(v), 0, XFADE_MAX) : 0; };
export function setCrossfade(s) { store.set('prefs.musicCrossfade', clamp(Math.round(Number(s)) || 0, 0, XFADE_MAX)); bus.emit('playerfx:change', 'crossfade'); }

/* ---------------- the graph ---------------- */
const G = { el: null, readable: () => true, ctx: null, src: null, pre: null, filters: [], built: false, why: '', building: false };

const AC = () => (typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null);
export const supported = () => !!AC();

/** Music hands over its element, and says whether the sound can be processed right now. */
export function attach(el, readable) {
  G.el = el;
  if (typeof readable === 'function') G.readable = readable;
  const again = () => tryRoute();
  el.addEventListener('playing', again);
  if (typeof document !== 'undefined') {
    /* a first click lets the browser start an AudioContext it had held back */
    document.addEventListener('pointerdown', again, { passive: true });
    document.addEventListener('keydown', again, { passive: true });
  }
}

export const routed = () => G.built;

export function status() {
  const e = EQ();
  if (!supported()) return { active: false, routed: false, why: 'This browser has no Web Audio, so there is no equalizer here.' };
  if (!e.on) return { active: false, routed: G.built, why: 'Off.' };
  if (G.why) return { active: false, routed: G.built, why: G.why };
  if (!G.built) return { active: false, routed: false, why: 'Ready — it starts with the next sound.' };
  return { active: true, routed: true, why: '' };
}

/** Wire the element into the graph if the equalizer is on and the sound can be processed. */
export async function tryRoute() {
  const e = EQ();
  if (!G.el || !e.on || G.built || G.building || !supported()) { settleWhy(); return; }
  if (!G.readable()) { G.why = 'This station is coming through SomaFM’s plain server, which doesn’t let the browser process its sound. Songs and stations on the CORS servers work.'; bus.emit('playerfx:change', 'status'); return; }
  const Ctor = AC();
  if (typeof navigator !== 'undefined' && navigator.userActivation && !navigator.userActivation.hasBeenActive && !G.ctx) {
    G.why = 'Waiting for your first click — the browser doesn’t let a page process sound before that.';
    bus.emit('playerfx:change', 'status');
    return;
  }
  G.building = true;
  try {
    if (!G.ctx) G.ctx = new Ctor();
    if (G.ctx.state !== 'running') await G.ctx.resume().catch(() => {});
    if (G.ctx.state !== 'running') { G.why = 'Waiting for your first click — the browser holds audio processing back until then.'; return; }
    if (!G.readable()) return;                              /* the source changed while the context started */
    const ctx = G.ctx;
    G.src = ctx.createMediaElementSource(G.el);
    G.pre = ctx.createGain();
    G.filters = BANDS.map((f, i) => {
      const b = ctx.createBiquadFilter();
      b.type = i === 0 ? 'lowshelf' : i === BANDS.length - 1 ? 'highshelf' : 'peaking';
      b.frequency.value = f;
      b.Q.value = 1.1;
      b.gain.value = 0;
      return b;
    });
    let node = G.src.connect(G.pre);
    for (const f of G.filters) node = node.connect(f);
    node.connect(ctx.destination);
    G.built = true;
    G.why = '';
    apply();
  } catch (err) {
    G.why = 'The equalizer couldn’t start in this browser.';
  } finally {
    G.building = false;
    bus.emit('playerfx:change', 'status');
  }
}
function settleWhy() {
  if (G.why && (G.built || !EQ().on)) { G.why = ''; bus.emit('playerfx:change', 'status'); }
}

/** Set the filters to the saved curve (flat when the equalizer is off). */
function apply() {
  if (!G.built) return;
  const e = EQ();
  const t = G.ctx.currentTime;
  const gains = e.on ? e.gains : PRESETS[0].gains;
  gains.forEach((g, i) => G.filters[i].gain.setTargetAtTime(g, t, 0.015));
  /* boosting raises the peak level, so the preamp comes down by about half the loudest boost to stop it clipping */
  const peak = Math.max(0, ...gains);
  G.pre.gain.setTargetAtTime(Math.pow(10, -(peak * 0.5) / 20), t, 0.015);
}

/** For tests and the panel: how the graph really is right now. */
export function debug() {
  return { built: G.built, ctx: G.ctx ? G.ctx.state : null, gains: G.filters.map(f => f.gain.value), pre: G.pre ? G.pre.gain.value : null };
}

export default { routed, EQ, setEqOn, setPreset, setGain, resetEq, status, attach, tryRoute, speed, setSpeed, crossfade, setCrossfade, PRESETS, BANDS, BAND_LABELS, SPEEDS, RANGE, XFADE_MAX, supported, debug };
