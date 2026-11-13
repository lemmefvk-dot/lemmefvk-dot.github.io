/* ============================================================
   metrics.js — what the browser will actually tell us.

   The System Monitor used to invent sixteen CPU cores, a process
   table and a set of disk volumes, and animate them with
   Math.random(). It looked convincing and meant nothing.

   A page genuinely cannot see host CPU load, GPU load, real
   process lists or disk I/O. No browser exposes any of it, and
   no amount of wanting changes that. What a page CAN see is
   listed below, and every one of these is read from a real API:

     frame rate        measured by counting animation frames
     JS heap           performance.memory (Chromium only)
     storage           navigator.storage.estimate()
     logical cores     navigator.hardwareConcurrency
     device memory     navigator.deviceMemory (coarse, rounded by
                       the browser on purpose)
     network class     navigator.connection
     transferred bytes performance.getEntriesByType('resource')
     page timing       performance.getEntriesByType('navigation')
     battery           navigator.getBattery()
     windows and apps  Static's own window manager

   Every reading carries `real: true`. Anything this module cannot
   measure is simply absent rather than filled in — callers are
   expected to omit it or label it, never to dress it up.
   ============================================================ */

import { bus } from './bus.js';

const CAP = 90;                  /* samples kept per series */

const series = {
  fps: [],
  heap: [],
  net: [],
};

const push = (arr, v) => { arr.push(v); while (arr.length > CAP) arr.shift(); };

/* ---------- frame rate ------------------------------------- *
 * Counted, not guessed: how many animation frames actually ran
 * in the last second. This is the one live performance figure a
 * page can honestly report, and it is genuinely useful — it is
 * what tells you the machine is struggling.                    */

let frames = 0;
let lastFpsAt = 0;
let fps = 0;
let rafId = 0;
let running = false;
let lastFrameAt = 0;

function tick(now) {
  frames++;
  if (lastFrameAt) frameTime(now - lastFrameAt);
  lastFrameAt = now;
  if (!lastFpsAt) lastFpsAt = now;
  if (now - lastFpsAt >= 1000) {
    fps = Math.round((frames * 1000) / (now - lastFpsAt));
    frames = 0;
    lastFpsAt = now;
    push(series.fps, fps);
    sample();
  }
  if (running) rafId = requestAnimationFrame(tick);
}

/* Several places want frame-rate samples at once — the Monitor app, the
   widget rail's monitor card, Settings and Static Developer. They used to
   share one global on/off switch, so whoever called stop() first killed
   the feed for everyone, and anyone who forgot to call it left a 60 fps
   rAF loop running for the life of the page.

   So each caller claims the sampler under its own name and releases it
   under the same name; the loop runs while at least one claim is held.
   A bare start()/stop() still works and counts as one shared claim, which
   is exactly the old behaviour for a single caller. */
const holders = new Set();

function runLoop() {
  if (running || !holders.size) return;
  if (typeof document !== 'undefined' && document.hidden) return;   /* nothing to sample behind a hidden tab */
  running = true;
  lastFpsAt = 0;
  lastFrameAt = 0;
  frames = 0;
  rafId = requestAnimationFrame(tick);
}

function haltLoop() {
  running = false;
  cancelAnimationFrame(rafId);
}

export function start(owner = 'shared') {
  holders.add(owner);
  runLoop();
}

export function stop(owner = 'shared') {
  holders.delete(owner);
  if (!holders.size) haltLoop();
}

/** Who is currently holding the sampler open — for diagnostics. */
export const claims = () => [...holders];

/* Counting frames in a background tab measures nothing and costs power,
   so park the loop while the tab is hidden and pick it up on return. */
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) haltLoop();
    else runLoop();
  });
}

/* ---------- frame times during a transition ----------------- *
 * The fps figure above says how the last second went on average,
 * which hides exactly what makes an animation look rough: one long
 * frame in the middle of it. So the window manager and the shell
 * call track() as a transition starts; while it runs, every frame's
 * duration is recorded, and when it ends the report says how many
 * frames ran, the longest one, and how many display refreshes were
 * missed. Measured, never estimated: a hidden tab runs no frames,
 * and its report says frames: 0.
 *
 * A missed refresh is counted against the display's own frame
 * interval, read from the shortest recent frames (60 Hz → 16.7 ms,
 * 120 Hz → 8.3 ms): a 33 ms frame on a 60 Hz screen is one dropped.
 *
 * The frame in which a transition starts is not counted: it also holds
 * whatever ran to set it up (an app mounting, a click handler), and an
 * animation does not begin until that frame is drawn — so it is input
 * latency, not a stutter in the animation. Every frame after it is. */
const recorders = new Set();
const reports = [];
const recent = [];                 /* last frame times, for the refresh interval */
let refreshMs = 1000 / 60;
let trackSeq = 0;

function frameTime(dt) {
  if (!(dt > 0) || dt > 2000) return;     /* a tab coming back from the background */
  recorders.forEach(r => { if (r.skip) r.skip--; else r.dts.push(dt); });
  recent.push(dt);
  if (recent.length > 120) recent.shift();
  if (recent.length >= 8) {
    const sorted = [...recent].sort((a, b) => a - b);
    /* the 10th percentile is a frame that was not late — the display's own beat */
    refreshMs = Math.min(1000 / 30, Math.max(1000 / 240, sorted[Math.floor(sorted.length * 0.1)]));
  }
}

/**
 * Record frame times for `ms` milliseconds (plus a short tail, so the
 * frame that finishes the animation is counted). Returns a promise of
 * the report, which also goes into transitions() and out on the bus
 * as 'metrics:transition'.
 */
export function track(label, ms = 300) {
  const owner = `transition:${label}:${++trackSeq}`;
  /* skip: the first frame delta, which spans the setup (see above) — when
     the loop is already running; a freshly started loop has no delta yet */
  const rec = { label: String(label), ms, at: Date.now(), dts: [], skip: running ? 1 : 0 };
  recorders.add(rec);
  start(owner);
  return new Promise(resolve => {
    setTimeout(() => {
      recorders.delete(rec);
      stop(owner);
      const dts = rec.dts;
      const beat = refreshMs;
      const dropped = dts.reduce((n, dt) => n + Math.max(0, Math.round(dt / beat) - 1), 0);
      const report = {
        real: true,
        label: rec.label,
        at: rec.at,
        ms: rec.ms,
        frames: dts.length,
        worst: dts.length ? Math.round(Math.max(...dts) * 10) / 10 : null,
        avg: dts.length ? Math.round(dts.reduce((a, b) => a + b, 0) / dts.length * 10) / 10 : null,
        refresh: Math.round(beat * 10) / 10,
        dropped,
      };
      reports.push(report);
      while (reports.length > 60) reports.shift();
      bus.emit('metrics:transition', report);
      resolve(report);
    }, ms + 120);
  });
}

/** The last transitions that were measured, oldest first. */
export const transitions = () => reports.map(r => ({ ...r }));
/** The display's frame interval as measured, in ms. */
export const refreshInterval = () => refreshMs;

/* ---------- one-shot readings ------------------------------ */

const bytes = n => {
  const v = Number(n) || 0;
  if (v >= 1024 ** 3) return `${(v / 1024 ** 3).toFixed(1)} GB`;
  if (v >= 1024 ** 2) return `${(v / 1024 ** 2).toFixed(1)} MB`;
  if (v >= 1024) return `${(v / 1024).toFixed(0)} KB`;
  return `${v} B`;
};
export { bytes as formatBytes };

/** Chromium exposes the JS heap; Firefox and Safari do not. */
export function heap() {
  const m = performance.memory;
  if (!m || !m.jsHeapSizeLimit) return null;
  return {
    real: true,
    used: m.usedJSHeapSize,
    total: m.totalJSHeapSize,
    limit: m.jsHeapSizeLimit,
    pct: Math.round((m.usedJSHeapSize / m.jsHeapSizeLimit) * 100),
  };
}

/** Origin storage actually in use, and what the browser will allow. */
export async function storage() {
  if (!navigator.storage?.estimate) return null;
  try {
    const e = await navigator.storage.estimate();
    if (!e || !e.quota) return null;
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    return {
      real: true,
      used: e.usage || 0,
      quota: e.quota,
      pct: Math.round(((e.usage || 0) / e.quota) * 100),
      persisted,
      /* usageDetails is Chromium-only and often the interesting part */
      detail: e.usageDetails || null,
    };
  } catch (err) {
    return null;
  }
}

/** Everything the page has downloaded, from the Resource Timing buffer. */
export function network() {
  let list;
  try { list = performance.getEntriesByType('resource'); }
  catch (err) { return null; }
  if (!list) return null;
  let transferred = 0;
  let decoded = 0;
  let cached = 0;
  const byType = new Map();
  for (const r of list) {
    transferred += r.transferSize || 0;
    decoded += r.decodedBodySize || 0;
    /* a zero transferSize with a real body means it came from cache */
    if (!r.transferSize && r.decodedBodySize) cached++;
    const k = r.initiatorType || 'other';
    byType.set(k, (byType.get(k) || 0) + (r.transferSize || 0));
  }
  return {
    real: true,
    requests: list.length,
    transferred,
    decoded,
    cached,
    byType: [...byType.entries()].sort((a, b) => b[1] - a[1]),
    saved: Math.max(0, decoded - transferred),
  };
}

/** How long this page took to become usable. */
export function timing() {
  let nav;
  try { [nav] = performance.getEntriesByType('navigation'); }
  catch (err) { return null; }
  if (!nav) return null;
  return {
    real: true,
    dns: Math.round(nav.domainLookupEnd - nav.domainLookupStart),
    connect: Math.round(nav.connectEnd - nav.connectStart),
    ttfb: Math.round(nav.responseStart - nav.requestStart),
    download: Math.round(nav.responseEnd - nav.responseStart),
    dom: Math.round(nav.domContentLoadedEventEnd - nav.responseEnd),
    total: Math.round(nav.loadEventEnd || nav.duration),
    type: nav.type,
  };
}

/** Coarse, browser-rounded hardware facts. */
export function hardware() {
  const out = { real: true };
  if (navigator.hardwareConcurrency) out.cores = navigator.hardwareConcurrency;
  if (navigator.deviceMemory) out.memoryGB = navigator.deviceMemory;
  out.platform = navigator.userAgentData?.platform || navigator.platform || 'unknown';
  out.mobile = !!navigator.userAgentData?.mobile;
  const ua = navigator.userAgent;
  const m = ua.match(/(Firefox|Edg|OPR|Chrome|Safari)\/([\d.]+)/);
  out.browser = m ? `${m[1] === 'Edg' ? 'Edge' : m[1] === 'OPR' ? 'Opera' : m[1]} ${m[2].split('.')[0]}` : 'unknown';
  out.dpr = window.devicePixelRatio || 1;
  out.screen = `${screen.width}×${screen.height}`;
  out.viewport = `${innerWidth}×${innerHeight}`;
  return out;
}

/** Connection class, where the browser reports it. */
export function connection() {
  const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!c) return null;
  return {
    real: true,
    type: c.effectiveType || '',
    downlink: c.downlink || 0,
    rtt: c.rtt || 0,
    saveData: !!c.saveData,
  };
}

/** Battery, if the browser still exposes it (many no longer do). */
export async function battery() {
  if (!navigator.getBattery) return null;
  try {
    const b = await navigator.getBattery();
    return {
      real: true,
      level: Math.round(b.level * 100),
      charging: b.charging,
      timeToEmpty: Number.isFinite(b.dischargingTime) ? b.dischargingTime : null,
      timeToFull: Number.isFinite(b.chargingTime) ? b.chargingTime : null,
    };
  } catch (err) {
    return null;
  }
}

/** Static's own state — the one "process table" that is genuinely real. */
export function windows() {
  const els = [...document.querySelectorAll('.win')];
  return {
    real: true,
    count: els.length,
    apps: els.map(el => ({
      app: el.dataset.app || 'unknown',
      title: el.getAttribute('aria-label') || '',
      minimised: el.classList.contains('is-min'),
      focused: el.classList.contains('is-focus'),
      w: Math.round(el.offsetWidth),
      h: Math.round(el.offsetHeight),
    })),
  };
}

/* ---------- the rolling snapshot --------------------------- */

let latest = null;

function sample() {
  const h = heap();
  if (h) push(series.heap, h.pct);
  const n = network();
  if (n) push(series.net, n.transferred);
  latest = {
    at: Date.now(),
    fps,
    heap: h,
    network: n,
    connection: connection(),
    windows: windows(),
  };
  bus.emit('metrics:tick', latest);
}

export const isRunning = () => running;
export const snapshot = () => latest;
export const history = () => ({ fps: [...series.fps], heap: [...series.heap], net: [...series.net] });
export const currentFps = () => fps;

/**
 * Everything at once, including the async readings.
 *
 * Starts the frame counter if it is not already running and waits one
 * beat for it, because a caller asking for "everything" and getting
 * `fps: 0` would be reading a number that was never measured.
 */
export async function full({ measure = true } = {}) {
  if (measure && !running) {
    start();
    await new Promise(r => setTimeout(r, 1100));
  }
  const [store, batt] = await Promise.all([storage(), battery()]);
  return {
    at: Date.now(),
    fps: running ? fps : null,
    heap: heap(),
    storage: store,
    battery: batt,
    network: network(),
    timing: timing(),
    hardware: hardware(),
    connection: connection(),
    windows: windows(),
    history: history(),
  };
}

/** What the browser refused to tell us, so the UI can say so plainly. */
export function unavailable() {
  const out = [];
  if (!performance.memory) out.push(['JS heap', 'only Chromium reports this']);
  if (!navigator.storage?.estimate) out.push(['Storage', 'not exposed by this browser']);
  if (!navigator.connection) out.push(['Connection class', 'not exposed by this browser']);
  if (!navigator.getBattery) out.push(['Battery', 'no longer exposed to pages here']);
  out.push(['CPU load', 'no browser exposes host CPU usage']);
  out.push(['GPU load', 'no browser exposes GPU usage']);
  out.push(['Disk I/O', 'no browser exposes host disk activity']);
  out.push(['Process list', 'a page cannot see other processes']);
  return out;
}

export default {
  start, stop, snapshot, history, full, currentFps, isRunning, track, transitions, refreshInterval,
  heap, storage, network, timing, hardware, connection, battery, windows,
  unavailable, formatBytes: bytes,
};
