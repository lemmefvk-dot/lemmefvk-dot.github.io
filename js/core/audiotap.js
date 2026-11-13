/* ============================================================
   audiotap.js — lets the desktop hear the OS's own music.

   Music and Static Radio each play through one module-level
   <audio>. They register it here, with a function that says whether
   the browser will let a page read that sound:
     · a song from ~/Music is a blob: URL from this origin — always;
     · a radio stream only when it was fetched with CORS. A stream
       without CORS still plays, but the browser won't let a page
       read it, so it is reported as blocked — with the reason —
       rather than drawn as a flat line that would pretend nothing
       is playing.

   Reading taps the element with captureStream(): the sound is not
   re-routed, so a suspended or failing AudioContext can never silence
   or double the music. Browsers without it (Safari; Firefox's
   mozCaptureStream re-routes and mutes the element, so it is not used)
   report 'unsupported'.

   ONE reader per element, shared by everything that draws from it (the
   wallpaper visualizer, Music's own spectrum): one captureStream(), one
   AudioContext, one AnalyserNode. Measured in Chrome: when two captures
   of the same element are wired up close together, only the newer one
   is fed — the older reads silence forever. So nothing here ever
   captures an element twice.

   register(id, el, { label, blocked })   blocked() → null | 'why'
   source(id) / current() / list()
   use(src, who) → reader       reader.an is the shared AnalyserNode
   pull(reader)  → 'ok' | 'suspended' | 'starting'   (throws if the
                 browser refuses to capture: cross-origin data)
   drop(el, who) the last user out stops the capture and closes the
                 AudioContext
   status / setStatus   what the wallpaper visualizer is doing, so
                 Settings can say it (bus 'visualizer:status')
   ============================================================ */
import { bus } from './bus.js';

const sources = new Map();          /* id -> { id, el, label, blocked } */
const readers = new WeakMap();      /* el -> reader */
const EVENTS = ['playing', 'pause', 'ended', 'emptied', 'error', 'volumechange'];
const AC = () => (typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null);

/** Can this browser read a page's own audio without re-routing it? */
export function canTap() {
  if (typeof window === 'undefined' || typeof HTMLMediaElement === 'undefined') return false;
  return typeof HTMLMediaElement.prototype.captureStream === 'function'
    && !!AC() && typeof MediaStream === 'function';
}

/** A player announces its element. Returns an unregister function. */
export function register(id, el, opts = {}) {
  if (!el) return () => {};
  const src = {
    id, el,
    label: opts.label || id,
    blocked: typeof opts.blocked === 'function' ? opts.blocked : () => null,
  };
  sources.set(id, src);
  const ping = () => bus.emit('audiotap:change', id);
  for (const ev of EVENTS) el.addEventListener(ev, ping);
  ping();
  return () => {
    if (sources.get(id) === src) sources.delete(id);
    for (const ev of EVENTS) el.removeEventListener(ev, ping);
    ping();
  };
}

/* making sound right now: playing, not stalled before the first frame */
const sounding = el => !!el && !el.paused && !el.ended && el.readyState >= 2 && !!(el.currentSrc || el.src);

export const source = id => sources.get(id) || null;
export const list = () => [...sources.values()];
export function current() {
  for (const s of sources.values()) if (sounding(s.el)) return s;
  return null;
}

/* ---- the shared reader ---------------------------------------------- */
export function use(src, who) {
  let r = readers.get(src.el);
  if (!r) {
    r = { el: src.el, users: new Set(), ctx: null, an: null, sink: null, stream: null, track: null, node: null };
    readers.set(src.el, r);
  }
  r.users.add(who);
  return r;
}

/**
 * Keep the analyser fed from the element's newest live track. Each new
 * src on an element adds a track to its captured stream, and Chrome leaves
 * the old one "live" but silent — so follow the newest and stop the rest.
 * The AudioContext is made on first need (by then the page has had a
 * click, so it may start) and closed when the last user drops it.
 */
export function pull(r) {
  if (!r.ctx || r.ctx.state === 'closed') {
    const C = AC();
    if (!C) throw new Error('no WebAudio');
    r.ctx = new C();
    r.an = r.sink = r.node = r.track = null;
  }
  if (r.ctx.state !== 'running') {
    try { r.ctx.resume().catch(() => {}); } catch (e) { /* closed meanwhile */ }
    return 'suspended';
  }
  if (!r.an) {
    r.an = r.ctx.createAnalyser();
    r.an.fftSize = 1024;
    r.an.smoothingTimeConstant = 0.8;
    r.sink = r.ctx.createGain();
    r.sink.gain.value = 0;                       /* keeps the graph pulled, adds no sound */
    r.an.connect(r.sink).connect(r.ctx.destination);
  }
  if (!r.stream) r.stream = r.el.captureStream();
  const live = r.stream.getAudioTracks().filter(t => t.readyState === 'live');
  const tr = live[live.length - 1];
  if (!tr) return 'starting';
  if (tr !== r.track || !r.node) {
    try { r.node?.disconnect(); } catch (e) { /* already gone */ }
    r.node = r.ctx.createMediaStreamSource(new MediaStream([tr]));
    r.node.connect(r.an);
    r.track = tr;
    for (const old of live.slice(0, -1)) { try { old.stop(); r.stream.removeTrack(old); } catch (e) { /* fine */ } }
  }
  return 'ok';
}

export function drop(el, who) {
  const r = el && readers.get(el);
  if (!r) return;
  r.users.delete(who);
  if (r.users.size) return;
  try { r.node?.disconnect(); } catch (e) { /* already gone */ }
  try { r.ctx?.close()?.catch?.(() => {}); } catch (e) { /* already closed */ }
  /* the capture goes too: the next user captures afresh, alone, rather
     than wiring an old track into a new context */
  try { r.stream?.getTracks().forEach(t => t.stop()); } catch (e) { /* already stopped */ }
  r.ctx = r.an = r.sink = r.node = r.track = r.stream = null;
}

/* ---- what the visualizer is doing --------------------------------- */
/* state: off | reduced | phone | unsupported | gamemode | hidden | idle |
          muted | blocked | suspended | starting | silent | drawing */
export const status = { state: 'off', source: null, detail: '' };

export function setStatus(next) {
  const s = { state: next.state || 'off', source: next.source || null, detail: next.detail || '' };
  if (s.state === status.state && s.source === status.source && s.detail === status.detail) return;
  Object.assign(status, s);
  bus.emit('visualizer:status', { ...status });
}

export default { canTap, register, source, current, list, use, pull, drop, status, setStatus };
