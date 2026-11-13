/* ============================================================
   Camera — a real camera.

   The viewfinder is the live getUserMedia stream in a <video>, in
   a box sized to the stream's own aspect ratio, so the grid and the
   flash cover exactly the pixels a photo keeps.

   · Photo: the current frame is drawn to a canvas at the stream's
     real resolution with the chosen look and mirroring baked into
     the pixels (ctx.filter + a soft-light tint — the same recipe the
     preview uses in CSS; a pixel-math fallback where ctx.filter is
     missing), encoded as JPEG and kept with media.save() in
     ~/Pictures/Camera.
   · Video: MediaRecorder on the camera plus the microphone. With a
     look or mirroring on, frames go through a canvas first, so what
     you see is what you keep. WebM from a live recorder carries no
     length; the measured one is written into its header so players
     can show and seek it. Saved in ~/Videos.

   Everything on screen is measured or read, never invented: the HUD
   shows resolution and frame rate from track.getSettings(), the
   recording badge counts real time and real bytes, the mic meter is
   an AnalyserNode, the filmstrip is the files on disk, and every
   notification names the file that was written and its true size.
   When the browser can't (no camera, blocked, busy, not https, no
   MediaRecorder) the viewfinder says so and what to do about it.

   The camera light is a promise: every track stops when the window
   closes, is minimised or hidden (phone layout, another tab), and
   the camera comes back when the window is visible again.

   During the spooky season Photo mode also has a photo booth —
   Halloween filters, frames and stickers, drawn by js/core/booth.js
   into the preview and the photo alike. Out of season it is not there.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as media from '../core/media.js';
import { createBooth } from '../core/booth.js';
import sfx from '../core/sfx.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-camera-css')) {
  const l = document.createElement('link');
  l.id = 'feat-camera-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-camera.css';
  document.head.appendChild(l);
}

/* ---------- looks ------------------------------------------------------
   A look is CSS filter functions plus an optional soft-light tint. The
   preview applies them to the <video> and an overlay; a capture applies
   the very same operations to the canvas, so the file matches the screen. */
const LOOKS = [
  { id: 'natural', name: 'Natural', ops: [], tint: null },
  { id: 'mono', name: 'Mono', ops: [['grayscale', 1], ['contrast', 1.1]], tint: null },
  { id: 'warm', name: 'Warm', ops: [['saturate', 1.08]], tint: [255, 150, 60, 0.42] },
  { id: 'cool', name: 'Cool', ops: [['saturate', 0.96]], tint: [70, 140, 255, 0.42] },
  { id: 'vivid', name: 'Vivid', ops: [['saturate', 1.45], ['contrast', 1.08]], tint: null },
];
const lookById = id => LOOKS.find(l => l.id === id) || LOOKS[0];
const cssFilter = look => (look.ops.length ? look.ops.map(([f, v]) => `${f}(${v})`).join(' ') : 'none');
const tintColor = look => (look.tint ? `rgb(${look.tint[0]},${look.tint[1]},${look.tint[2]})` : 'transparent');

/* Does ctx.filter really filter? (Setting an unknown property "works"
   everywhere, so this draws a red pixel through grayscale and looks.) */
let FILTER_OK = null;
function filterWorks() {
  if (FILTER_OK !== null) return FILTER_OK;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.filter = 'grayscale(1)';
    g.fillStyle = 'rgb(255,0,0)';
    g.fillRect(0, 0, 1, 1);
    const d = g.getImageData(0, 0, 1, 1).data;
    FILTER_OK = Math.abs(d[0] - d[1]) < 10 && Math.abs(d[1] - d[2]) < 10;
  } catch (err) { FILTER_OK = false; }
  return FILTER_OK;
}

/* The Filter Effects matrices for the functions LOOKS uses, in sRGB, with
   the per-function clamping CSS does (Uint8ClampedArray clamps for us). */
function applyOps(g, w, hh, ops) {
  const img = g.getImageData(0, 0, w, hh);
  const d = img.data;
  for (const [op, v] of ops) {
    let m = null;
    if (op === 'grayscale') {
      const s = 1 - Math.min(1, v);
      m = [0.2126 + 0.7874 * s, 0.7152 - 0.7152 * s, 0.0722 - 0.0722 * s,
        0.2126 - 0.2126 * s, 0.7152 + 0.2848 * s, 0.0722 - 0.0722 * s,
        0.2126 - 0.2126 * s, 0.7152 - 0.7152 * s, 0.0722 + 0.9278 * s];
    } else if (op === 'saturate') {
      m = [0.213 + 0.787 * v, 0.715 - 0.715 * v, 0.072 - 0.072 * v,
        0.213 - 0.213 * v, 0.715 + 0.285 * v, 0.072 - 0.072 * v,
        0.213 - 0.213 * v, 0.715 - 0.715 * v, 0.072 + 0.928 * v];
    }
    if (m) {
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], gr = d[i + 1], b = d[i + 2];
        d[i] = m[0] * r + m[1] * gr + m[2] * b;
        d[i + 1] = m[3] * r + m[4] * gr + m[5] * b;
        d[i + 2] = m[6] * r + m[7] * gr + m[8] * b;
      }
    } else if (op === 'contrast' || op === 'brightness') {
      const k = v, o = op === 'contrast' ? 127.5 * (1 - v) : 0;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = k * d[i] + o;
        d[i + 1] = k * d[i + 1] + o;
        d[i + 2] = k * d[i + 2] + o;
      }
    }
  }
  g.putImageData(img, 0, 0);
}

/** One camera frame onto a canvas, as the viewfinder shows it. */
function paintFrame(g, src, w, hh, look, mirror) {
  const f = cssFilter(look);
  const native = f !== 'none' && filterWorks();
  g.save();
  if (mirror) { g.translate(w, 0); g.scale(-1, 1); }
  if (native) g.filter = f;
  g.drawImage(src, 0, 0, w, hh);
  g.restore();
  if (f !== 'none' && !native) applyOps(g, w, hh, look.ops);
  if (look.tint) {
    g.save();
    g.globalCompositeOperation = 'soft-light';
    g.globalAlpha = look.tint[3];
    g.fillStyle = tintColor(look);
    g.fillRect(0, 0, w, hh);
    g.restore();
  }
}

/* ---------- recording --------------------------------------------------- */
const TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm',
  'video/mp4;codecs=avc1,mp4a', 'video/mp4'];

/** The first container this browser can record; '' = let it choose; null = it can't record. */
function recorderType() {
  if (typeof MediaRecorder !== 'function') return null;
  if (typeof MediaRecorder.isTypeSupported !== 'function') return '';
  return TYPES.find(t => MediaRecorder.isTypeSupported(t)) ?? null;
}

/* WebM from a live MediaRecorder has an unknown-size Segment and no
   Duration in its Info, so players show "Infinity" and can't seek. Write
   the measured length into Info. Only the head is rewritten; the clusters
   are copied untouched. Anything unexpected returns the file as it was. */
const EBML = 0x1A45DFA3, SEGMENT = 0x18538067, INFO = 0x1549A966, SCALE = 0x2AD7B1,
  DURATION = 0x4489, SEEKHEAD = 0x114D9B74, CLUSTER = 0x1F43B675;
function vintLen(first, max) {
  let len = 1, mask = 0x80;
  while (len <= max && !(first & mask)) { mask >>= 1; len++; }
  return len > max ? 0 : len;
}
function readId(b, i) {
  if (i >= b.length) return null;
  const len = vintLen(b[i], 4);
  if (!len || i + len > b.length) return null;
  let id = 0;
  for (let k = 0; k < len; k++) id = id * 256 + b[i + k];
  return { id, len };
}
function readSize(b, i) {
  if (i >= b.length) return null;
  const len = vintLen(b[i], 8);
  if (!len || i + len > b.length) return null;
  const mask = 0xff >> len;
  let v = b[i] & mask, ones = v === mask;
  for (let k = 1; k < len; k++) { v = v * 256 + b[i + k]; if (b[i + k] !== 0xff) ones = false; }
  return { size: v, len, unknown: ones };
}
function size8(n) {
  const out = new Uint8Array(8);
  out[0] = 0x01;
  let v = n;
  for (let k = 7; k >= 1; k--) { out[k] = v % 256; v = Math.floor(v / 256); }
  return out;
}
async function withDuration(blob, ms) {
  try {
    const b = new Uint8Array(await blob.slice(0, Math.min(blob.size, 65536)).arrayBuffer());
    const head = readId(b, 0);
    if (!head || head.id !== EBML) return blob;
    const hs = readSize(b, head.len);
    let i = head.len + hs.len + hs.size;
    const seg = readId(b, i);
    if (!seg || seg.id !== SEGMENT) return blob;
    const ss = readSize(b, i + seg.len);
    if (!ss || !ss.unknown) return blob;
    i += seg.len + ss.len;
    while (i < b.length) {
      const el = readId(b, i);
      const sz = el && readSize(b, i + el.len);
      if (!el || !sz || sz.unknown) return blob;
      const at = i + el.len + sz.len, end = at + sz.size;
      if (el.id === SEEKHEAD || el.id === CLUSTER || end > b.length) return blob;
      if (el.id === INFO) {
        let scale = 1e6;
        for (let j = at; j < end;) {
          const c = readId(b, j);
          const cs = c && readSize(b, j + c.len);
          if (!c || !cs) return blob;
          const cd = j + c.len + cs.len;
          if (c.id === DURATION) return blob;                 /* already there */
          if (c.id === SCALE) { scale = 0; for (let k = 0; k < cs.size; k++) scale = scale * 256 + b[cd + k]; }
          j = cd + cs.size;
        }
        const dur = new Uint8Array(11);
        dur.set([0x44, 0x89, 0x88]);
        new DataView(dur.buffer).setFloat64(3, (ms * 1e6) / (scale || 1e6));
        const body = b.subarray(at, end);
        return new Blob([b.subarray(0, i), b.subarray(i, i + el.len), size8(body.length + dur.length),
          body, dur, blob.slice(end)], { type: blob.type });
      }
      i = end;
    }
  } catch (err) { /* keep the recording as it came */ }
  return blob;
}

/** The true length of a recording in ms, found the way a player finds it
    (seek past the end of a stream-written file), or null. */
async function mediaLength(blob) {
  const v = document.createElement('video');
  const url = URL.createObjectURL(blob);
  v.muted = true;
  v.preload = 'metadata';
  const wait = (ok, ev, ms) => new Promise(res => {
    if (ok()) { res(); return; }
    const t = setTimeout(done, ms);
    function done() { clearTimeout(t); v.removeEventListener(ev, check); v.removeEventListener('error', done); res(); }
    function check() { if (ok()) done(); }
    v.addEventListener(ev, check);
    v.addEventListener('error', done);
  });
  try {
    v.src = url;
    await wait(() => v.readyState >= 1, 'loadedmetadata', 4000);
    if (v.readyState < 1) return null;
    if (!(Number.isFinite(v.duration) && v.duration > 0)) {
      v.currentTime = 1e7;
      await wait(() => Number.isFinite(v.duration) && v.duration > 0, 'durationchange', 4000);
    }
    return Number.isFinite(v.duration) && v.duration > 0 ? v.duration * 1000 : null;
  } catch (err) {
    return null;
  } finally {
    v.removeAttribute('src');
    try { v.load(); } catch (err) {}
    URL.revokeObjectURL(url);
  }
}

/* ---------- names, help text ------------------------------------------- */
const pad2 = n => String(n).padStart(2, '0');
/** A device label short enough for the title bar ("Integrated Webcam (0c45:6a1d)" → "Integrated Webcam"). */
function shortLabel(label) {
  let s = String(label || '').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim();
  if (s.includes('/')) s = s.split('/').pop();
  return s.length > 30 ? `${s.slice(0, 29)}…` : s;
}
const stamp = (d = new Date()) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}.${pad2(d.getMinutes())}.${pad2(d.getSeconds())}`;

function siteHelp() {
  const ua = navigator.userAgent || '';
  if (/Firefox\//.test(ua)) return 'Firefox is blocking the camera for this site. Click the crossed-out camera icon in the address bar, clear the “Blocked” permission, then press Try again.';
  if (/Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg\//.test(ua)) return 'Safari is blocking the camera for this site. Choose Safari › Settings for This Website… (or tap “aA” on iPhone and iPad), set Camera to Allow, then press Try again.';
  return 'The browser is blocking the camera for this site. Click the icon at the left end of the address bar (site settings or a crossed-out camera), set Camera to Allow, then press Try again.';
}
function osHelp() {
  const ua = navigator.userAgent || '';
  if (/Windows/.test(ua)) return 'Windows is not letting this browser use the camera. Open Settings › Privacy & security › Camera, turn on camera access for desktop apps, then press Try again.';
  if (/Mac/.test(ua)) return 'macOS is not letting this browser use the camera. Open System Settings › Privacy & Security › Camera, turn your browser on, restart it, then press Try again.';
  return 'The computer is not letting this browser use the camera. Allow camera access for the browser in the system settings, then press Try again.';
}

/** What went wrong, in words a person can act on. */
function cameraProblem(err) {
  const name = err?.name || '';
  const msg = String(err?.message || '');
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    if (/system/i.test(msg)) return { kind: 'os', icon: 'lock', title: 'Your computer is blocking the camera', body: osHelp() };
    if (/dismiss/i.test(msg)) return { kind: 'dismissed', icon: 'camera', title: 'Camera permission not given', body: 'The browser asked to use the camera and the question was closed. Press Allow camera to be asked again.', action: 'Allow camera' };
    return { kind: 'denied', icon: 'lock', title: 'Camera access is blocked', body: siteHelp() };
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return { kind: 'nocam', icon: 'camera', title: 'No camera found', body: 'This device has no camera the browser can see. Plug one in or switch it on, then press Try again.' };
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return { kind: 'busy', icon: 'alert', title: 'The camera is in use', body: 'Another app or browser tab is using it, or it stopped responding. Close the other app (video calls often keep it), then press Try again.' };
  }
  return { kind: 'failed', icon: 'alert', title: 'The camera couldn\'t start',
    body: `The browser said: “${msg || 'no details'}” (${name || 'Error'}). Press Try again; if it keeps happening, reload StaticOS or restart the browser.` };
}

/* ======================================================================== */

defineApp({
  id: 'camera',
  name: 'Camera',
  icon: 'camera',
  g1: '#8fa3bd', g2: '#3b465c',
  category: 'Media',
  keywords: ['photo', 'video', 'webcam', 'selfie', 'record', 'picture', 'filter', 'timer'],
  desc: 'Take photos and videos with your camera',
  pinned: true,
  singleton: true,
  win: { w: 760, h: 640, minW: 420, minH: 420 },
  /* keys listed on the shortcut sheet (hold ⌘ / Ctrl): each one is bound below */
  shortcuts: [
    ['Space', 'Take the photo, or start / stop recording'],
    ['T', 'Self-timer: off, 3 s, 10 s'],
    ['G', 'Grid'],
    ['M', 'Mirror'],
    ['Esc', 'Cancel the self-timer'],
  ],

  mount(ctx) {
    const { root, win, opts, api } = ctx;
    const { h, icon, vfs, fmt, store, bus } = api;

    const PHOTOS = `${vfs.HOME}/Pictures/Camera`;
    const VIDEOS = `${vfs.HOME}/Videos`;
    const pref = (k, d) => store.get(`prefs.camera.${k}`, d);
    const setPref = (k, v) => store.set(`prefs.camera.${k}`, v);
    const reduced = () => !!store.get('prefs.reduceMotion')
      || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

    const S = {
      phase: 'idle',          /* idle | starting | live | paused | error */
      problem: null,
      perm: '',               /* camera permission state, when the browser tells */
      stream: null, track: null, settings: {}, label: '', muted: false,
      gen: 0,
      devices: [],
      deviceId: pref('deviceId', '') || '',
      mode: (opts?.mode || pref('mode', 'photo')) === 'video' ? 'video' : 'photo',
      look: lookById(pref('look', 'natural')).id,
      grid: pref('grid', true) !== false,
      looksOpen: pref('looksOpen', true) !== false,
      mirror: true,
      timer: 0,
      count: null,            /* { n, t } while the self-timer runs */
      rec: null,              /* the recording in progress */
      mic: null, micState: 'off', micErr: '', micGen: 0, meter: null,
      permStatus: null,
      dead: false,
    };

    const timers = new Set();
    const after = (ms, fn) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
    const urls = new Set();
    const offs = [];

    /* two glyphs the shared set lacks, drawn in its style (24px grid, stroked) */
    const glyph = (...d) => h('span.icon', h('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, d.map(x => h('path', { d: x }))));
    const camGlyph = () => glyph('M4 6.5h9.5a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z', 'M15.5 10.5 22 7v10l-6.5-3.5');

    /* ============================ layout ============================ */
    const video = h('video.cam__video', { autoplay: true, muted: true, playsinline: true, 'aria-hidden': 'true' });
    video.muted = true;
    const tint = h('div.cam__tint');
    const pic = h('div.cam__pic', video, tint);
    const grid = h('div.cam__grid', { 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'));
    const flashEl = h('div.cam__flash', { 'aria-hidden': 'true' });
    const frame = h('div.cam__frame', pic, grid, flashEl);

    const fmtPill = h('span.cam-pill.mono', { title: 'Reported by the camera (track settings)' });
    const recTime = h('span');
    const recPill = h('span.cam-pill.cam-pill--rec.mono', h('i'), recTime);
    const meterFill = h('i');
    const micText = h('span');
    const meterEl = h('span.cam-meter', { 'aria-hidden': 'true', hidden: true }, meterFill);
    const micPill = h('button.cam-pill.cam-pill--mic', { type: 'button', onclick: () => { if (S.micState !== 'on') startMic(); } },
      icon('mic'), micText, meterEl);
    const notePill = h('span.cam-pill.cam-pill--note');
    const timerPill = h('span.cam-pill', icon('clock'), h('span'));
    const hud = h('div.cam__hud',
      h('div.cam__hudrow', fmtPill, h('span.cam__grow'), timerPill, recPill),
      h('div.cam__hudrow', micPill, h('span.cam__grow'), notePill));

    const countNum = h('b');
    const countEl = h('div.cam__count', { 'aria-hidden': 'true' }, h('div.cam__countring', countNum));
    const stateEl = h('div.cam__state');
    const stage = h('div.cam__stage', { role: 'group', 'aria-label': 'Viewfinder' }, frame, hud, countEl, stateEl);

    /* the spooky photo booth: a canvas over the picture, a panel, a deck button */
    const booth = createBooth({
      api, frameEl: frame, video,
      base: (g, w, hh) => paintFrame(g, video, w, hh, lookNow(), S.mirror),
      photoMode: () => S.mode === 'photo',
      live: () => S.phase === 'live',
      load: () => pref('booth', null),
      save: v => setPref('booth', v),
      onOpen: () => { if (S.looksOpen) toggleLooks(); },
    });
    frame.insertBefore(booth.layer, grid);

    /* looks: every preview is the live camera through that look */
    const lookBtns = LOOKS.map(l => {
      const v = h('video', { autoplay: true, muted: true, playsinline: true, 'aria-hidden': 'true', style: { filter: cssFilter(l) } });
      v.muted = true;
      const b = h('button.cam-look', {
        type: 'button', dataset: { look: l.id }, 'aria-pressed': 'false',
        onclick: () => setLook(l.id),
      }, h('span.cam-look__pv', v, l.tint
        ? h('span.cam-look__tint', { style: { background: tintColor(l), opacity: String(l.tint[3]) } })
        : null), h('span.cam-look__name', { text: l.name }));
      b.pv = v;
      return b;
    });
    const looksNote = h('small.cam__looksnote');
    const looksRow = h('div.cam__looks', h('div.cam__looksin', { role: 'group', 'aria-label': 'Looks' }, lookBtns, looksNote));

    const strip = h('div.cam__strip', { role: 'group', 'aria-label': 'Captures' });
    const allCount = h('b');
    const allBtn = h('button.cam-all', { type: 'button' }, icon('folder-open'), allCount);

    const modeBtn = (id, label, ic) => h('button', {
      type: 'button', dataset: { mode: id }, 'aria-pressed': 'false', onclick: () => setMode(id),
    }, ic, label);
    const seg = h('div.seg.cam__seg', { role: 'group', 'aria-label': 'Mode' },
      modeBtn('photo', 'Photo', icon('camera')), modeBtn('video', 'Video', camGlyph()));

    const shutter = h('button.cam__shutter', { type: 'button', onclick: () => fire() }, h('i'));
    const timerText = h('span');
    const timerBtn = h('button.cam-tool', { type: 'button', onclick: () => cycleTimer() }, icon('clock'), timerText);
    const looksBtn = h('button.cam-tool', { type: 'button', onclick: () => toggleLooks() }, icon('palette'), h('span.cam-tool__lbl', { text: 'Looks' }));
    const switchBtn = h('button.cam-tool', { type: 'button', 'aria-label': 'Switch camera', title: 'Switch camera', onclick: () => nextCamera() }, icon('refresh'));
    const deck = h('div.cam__deck',
      h('div.cam__deckl', seg),
      shutter,
      h('div.cam__deckr', timerBtn, booth.button, looksBtn, switchBtn));

    const live = h('div.sr', { 'aria-live': 'polite' });
    const say = text => { live.textContent = ''; after(30, () => { live.textContent = text; }); };

    root.appendChild(h('div.app.app--col.cam', stage, looksRow, booth.panel, strip, deck, live));

    /* title-bar tools: camera picker (when there are several), grid, mirror, folder */
    const mirrorGlyph = () => glyph('M12 3v2M12 9v2M12 13v2M12 19v2', 'M9 6 3 18h6z', 'M15 6l6 12h-6z');
    const pickSel = h('select.cam-sel', { 'aria-label': 'Camera', title: 'Camera', onchange: e => switchCamera(e.target.value) });
    const gridBtn = h('button.ibtn.tip.tip--below', { type: 'button', 'data-tip': 'Grid (G)', 'aria-label': 'Grid', onclick: () => toggleGrid() }, icon('grid'));
    const mirrorBtn = h('button.ibtn.tip.tip--below', { type: 'button', 'data-tip': 'Mirror (M)', 'aria-label': 'Mirror', onclick: () => toggleMirror() }, mirrorGlyph());
    const folderBtn = h('button.ibtn.tip.tip--below', { type: 'button', 'data-tip': 'Show in Files', 'aria-label': 'Show photos in Files', onclick: () => api.openApp('files', { path: PHOTOS }) }, icon('folder-open'));
    win.setTools(pickSel, gridBtn, mirrorBtn, folderBtn);

    /* ============================ painting ============================ */
    const canRecord = () => recorderType() !== null;
    /* in a browser without ctx.filter a look can't be applied to every video frame */
    const lookNow = () => (S.mode === 'video' && !filterWorks() ? LOOKS[0] : lookById(S.look));

    function paint() {
      if (S.dead) return;
      paintState(); paintHud(); paintDeck(); paintLooks(); paintTools(); paintView();
      win.setSubtitle(S.phase === 'live' ? shortLabel(S.label) : '');
    }

    function paintView() {
      const look = lookNow();
      video.style.filter = cssFilter(look);
      tint.style.background = tintColor(look);
      tint.style.opacity = look.tint ? String(look.tint[3]) : '0';
      pic.classList.toggle('is-mirror', S.mirror);
      grid.hidden = !S.grid;
      const w = video.videoWidth || S.settings.width, hh = video.videoHeight || S.settings.height;
      if (w && hh) frame.style.setProperty('--ar', String(w / hh));
      booth.sync();                             /* the booth's preview starts from this picture */
    }

    const cardBtn = (label, fn, primary) =>
      h(primary ? 'button.btn.btn--primary' : 'button.btn', { type: 'button', onclick: fn }, label);

    function paintState() {
      api.clear(stateEl);
      stateEl.hidden = S.phase === 'live';
      stage.classList.toggle('is-live', S.phase === 'live');
      if (S.phase === 'live') return;
      let card;
      if (S.phase === 'error' && S.problem) {
        const p = S.problem;
        card = h('div.cam-card', { role: 'alert' },
          h('div.cam-card__ic', icon(p.icon || 'alert')),
          h('b', { text: p.title }),
          h('p', { text: p.body }),
          p.retry === false ? null : h('div.cam-card__acts',
            cardBtn(p.action || 'Try again', () => start(), true),
            captures().length ? cardBtn('Show captures', () => api.openApp('files', { path: PHOTOS })) : null));
      } else if (S.phase === 'paused') {
        card = h('div.cam-card',
          h('div.cam-card__ic', icon('camera')),
          h('b', { text: 'Camera off' }),
          h('p', { text: 'It switches off while this window is hidden, so the camera light goes out.' }),
          h('div.cam-card__acts', cardBtn('Turn on', () => start(), true)));
      } else {
        card = h('div.cam-card', { role: 'status' },
          h('div.cam-card__spin', { 'aria-hidden': 'true' }),
          h('b', { text: 'Starting the camera…' }),
          h('p', { text: S.perm === 'granted' ? 'Connecting to your camera.' : 'Your browser will ask to use the camera — choose Allow.' }));
      }
      stateEl.append(card);
    }

    function fpsText(r) {
      if (!r) return '';
      const v = Math.round(r * 10) / 10;
      return ` · ${v % 1 ? v.toFixed(1) : v} fps`;
    }

    function paintHud() {
      const isLive = S.phase === 'live';
      const s = S.settings;
      fmtPill.hidden = !(isLive && s.width && s.height);
      if (!fmtPill.hidden) fmtPill.textContent = `${s.width}×${s.height}${fpsText(s.frameRate)}`;
      recPill.hidden = !S.rec;
      timerPill.hidden = !(isLive && S.timer && !S.rec && !S.count);
      timerPill.lastChild.textContent = `${S.timer}s timer`;

      micPill.hidden = !(isLive && S.mode === 'video' && canRecord());
      micPill.classList.toggle('is-off', S.micState !== 'on');
      micPill.disabled = S.micState === 'on' || S.micState === 'starting';
      const micMsg = {
        on: 'Mic', starting: 'Mic…', off: 'Mic off',
        blocked: 'No sound — microphone blocked', none: 'No sound — no microphone', failed: 'No sound — microphone failed',
      }[S.micState] || 'Mic';
      micText.textContent = micMsg;
      micPill.title = S.micState === 'on' ? 'Recording with sound (level shown live)'
        : S.micState === 'blocked' ? 'The browser is blocking the microphone. Allow it in the address bar, then click here.'
          : S.micState === 'starting' ? 'Asking for the microphone' : 'Click to try the microphone again';
      micPill.setAttribute('aria-label', micPill.title);

      let note = '';
      if (isLive && S.mode === 'video' && !canRecord()) note = 'This browser can\'t record video (no MediaRecorder) — photos still work';
      else if (isLive && S.muted) note = 'No picture from the camera right now';
      notePill.hidden = !note;
      notePill.textContent = note;
    }

    function paintDeck() {
      const isLive = S.phase === 'live';
      for (const b of seg.children) {
        const on = b.dataset.mode === S.mode;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', String(on));
        b.disabled = !!S.rec;
      }
      shutter.classList.toggle('is-video', S.mode === 'video');
      shutter.classList.toggle('is-rec', !!S.rec);
      shutter.classList.toggle('is-count', !!S.count);
      const blocked = !isLive || (S.mode === 'video' && !canRecord());
      shutter.disabled = blocked && !S.rec && !S.count;
      const label = S.count ? 'Cancel self-timer'
        : S.rec ? 'Stop recording'
          : S.mode === 'video' ? `Start recording${S.timer ? ` in ${S.timer} seconds` : ''}`
            : `Take photo${S.timer ? ` in ${S.timer} seconds` : ''}`;
      shutter.setAttribute('aria-label', `${label} (Space)`);
      shutter.title = `${label} (Space)`;

      timerText.textContent = S.timer ? `${S.timer}s` : 'Off';
      timerBtn.classList.toggle('is-on', !!S.timer);
      timerBtn.setAttribute('aria-label', `Self-timer: ${S.timer ? `${S.timer} seconds` : 'off'}`);
      timerBtn.title = 'Self-timer (T): off, 3 s, 10 s';
      timerBtn.disabled = !!S.rec;

      looksBtn.classList.toggle('is-on', S.looksOpen);
      looksBtn.setAttribute('aria-expanded', String(S.looksOpen));
      looksBtn.setAttribute('aria-label', `Looks: ${lookNow().name}`);
      looksBtn.title = `Looks — ${lookNow().name}`;
      looksBtn.querySelector('.cam-tool__lbl').textContent = lookNow().name;

      switchBtn.hidden = S.devices.length < 2;
      switchBtn.disabled = !!S.rec || S.phase === 'starting';
    }

    function paintLooks() {
      looksRow.hidden = !S.looksOpen || !(S.phase === 'live' || S.phase === 'starting');
      const locked = !!S.rec || (S.mode === 'video' && !filterWorks());
      for (const b of lookBtns) {
        const on = b.dataset.look === lookNow().id;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', String(on));
        b.disabled = locked;
        const want = S.looksOpen && S.stream ? S.stream : null;
        if (b.pv.srcObject !== want) {
          b.pv.srcObject = want;
          if (want) b.pv.play()?.catch?.(() => {});
        }
      }
      looksNote.hidden = !(S.mode === 'video' && !filterWorks());
      looksNote.textContent = 'This browser can only apply looks to photos.';
    }

    function paintTools() {
      const many = S.devices.length > 1;
      pickSel.hidden = !many;
      if (many) {
        api.clear(pickSel);
        S.devices.forEach((d, i) => {
          const o = h('option', { value: d.deviceId, text: d.label || `Camera ${i + 1}` });
          if (d.deviceId === S.deviceId) o.selected = true;
          pickSel.append(o);
        });
        pickSel.disabled = !!S.rec;
      }
      gridBtn.classList.toggle('is-on', S.grid);
      gridBtn.setAttribute('aria-pressed', String(S.grid));
      mirrorBtn.classList.toggle('is-on', S.mirror);
      mirrorBtn.setAttribute('aria-pressed', String(S.mirror));
      mirrorBtn.disabled = !!S.rec;
    }

    function paintCount() {
      countEl.hidden = !S.count;
      if (S.count) {
        countNum.textContent = String(S.count.n);
        countEl.classList.toggle('is-still', reduced());
        /* restart the per-second pulse */
        countEl.classList.remove('is-tick');
        void countEl.offsetWidth;
        countEl.classList.add('is-tick');
      }
      paintDeck(); paintHud();
    }

    /* ============================ the camera ============================ */
    function visible() {
      return !S.dead && !win.min && document.visibilityState !== 'hidden'
        && win.el.isConnected && win.el.getClientRects().length > 0;
    }

    function stopStream() {
      const t = S.track;
      if (t) {
        t.removeEventListener('ended', onEnded);
        t.removeEventListener('mute', onMute);
        t.removeEventListener('unmute', onMute);
      }
      S.stream?.getTracks().forEach(x => x.stop());
      S.stream = null; S.track = null; S.settings = {}; S.muted = false;
      video.srcObject = null;
      for (const b of lookBtns) b.pv.srcObject = null;
    }

    function fail(problem) {
      stopStream();
      stopMic();
      S.phase = 'error';
      S.problem = problem;
      paint();
      watchPermission();                        /* allowing the camera later starts it */
    }

    async function permState() {
      try { return (await navigator.permissions.query({ name: 'camera' })).state; } catch (err) { return ''; }
    }

    async function start() {
      if (S.dead) return;
      const gen = ++S.gen;
      cancelCountdown();
      stopStream();
      if (typeof isSecureContext !== 'undefined' && !isSecureContext) {
        return fail({ kind: 'insecure', icon: 'lock', retry: false, title: 'The camera needs a secure page',
          body: `Browsers only allow the camera on https:// pages (or localhost). This page is ${location.protocol}//${location.host}. Open StaticOS over https — for example https://staticos.surge.sh.` });
      }
      const md = navigator.mediaDevices;
      if (!md || typeof md.getUserMedia !== 'function') {
        return fail({ kind: 'unsupported', icon: 'camera', retry: false, title: 'This browser can\'t use a camera',
          body: 'navigator.mediaDevices.getUserMedia is missing here. A current Chrome, Edge, Firefox or Safari can use the camera.' });
      }
      S.phase = 'starting';
      S.problem = null;
      paint();
      if (!S.perm && navigator.permissions?.query) {
        navigator.permissions.query({ name: 'camera' })
          .then(st => { S.perm = st.state; if (!S.dead && S.phase === 'starting') paintState(); }, () => {});
      }
      const want = { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } };
      const ask = id => md.getUserMedia({ audio: false, video: id ? { ...want, deviceId: { exact: id } } : want });
      let stream = null, err = null;
      try { stream = await ask(S.deviceId); } catch (e) { err = e; }
      /* the remembered camera is gone: use the default one */
      if (!stream && S.deviceId && (err?.name === 'OverconstrainedError' || err?.name === 'NotFoundError') && gen === S.gen) {
        try { stream = await ask(''); err = null; } catch (e) { err = e; }
      }
      if (gen !== S.gen || S.dead) { stream?.getTracks().forEach(t => t.stop()); return; }
      if (!stream) {
        let problem = cameraProblem(err);
        /* the browser's permission store is the authority: some browsers report
           a blocked camera as a different error */
        if (problem.kind !== 'os' && problem.kind !== 'denied' && (await permState()) === 'denied') {
          problem = cameraProblem(new DOMException('Permission denied', 'NotAllowedError'));
        }
        if (gen !== S.gen || S.dead) return;
        fail(problem);
        return;
      }
      if (!visible()) {                         /* hidden while the browser was asking */
        stream.getTracks().forEach(t => t.stop());
        S.phase = 'paused';
        paint();
        return;
      }
      attach(stream);
    }

    function attach(stream) {
      S.stream = stream;
      const t = stream.getVideoTracks()[0];
      S.track = t;
      S.settings = t?.getSettings?.() || {};
      S.label = t?.label || 'Camera';
      S.muted = !!t?.muted;
      S.perm = 'granted';
      if (S.settings.deviceId) {
        S.deviceId = S.settings.deviceId;
        setPref('deviceId', S.deviceId);
      }
      S.mirror = mirrorFor(S.deviceId);
      t?.addEventListener('ended', onEnded);
      t?.addEventListener('mute', onMute);
      t?.addEventListener('unmute', onMute);
      video.srcObject = stream;
      video.play()?.catch?.(() => {});
      S.phase = 'live';
      refreshDevices();
      if (S.mode === 'video') startMic();
      paint();
    }

    function mirrorFor(id) {
      const saved = (pref('mirror', {}) || {})[id];
      if (typeof saved === 'boolean') return saved;
      /* a camera that faces away is not mirrored; a webcam or a phone's
         front camera faces you, and a mirror is what people expect there */
      if (S.settings.facingMode === 'environment' || /\b(back|rear|environment|world)\b/i.test(S.label)) return false;
      return true;
    }

    function onEnded() {
      if (S.dead) return;
      if (S.rec) stopRecording('ended');
      fail({ kind: 'ended', icon: 'camera', title: 'The camera stopped',
        body: 'It was unplugged, switched off, or taken over by another app. Press Try again to reconnect.' });
    }
    function onMute() {
      S.muted = !!S.track?.muted;
      paintHud();
    }

    async function refreshDevices() {
      try {
        const list = await navigator.mediaDevices.enumerateDevices();
        if (S.dead) return;
        S.devices = list.filter(d => d.kind === 'videoinput' && d.deviceId);
        paintTools(); paintDeck();
      } catch (err) { /* the picker just stays hidden */ }
    }

    async function watchPermission() {
      if (S.permStatus || !navigator.permissions?.query) return;
      try {
        const st = await navigator.permissions.query({ name: 'camera' });
        if (S.dead) return;
        S.permStatus = st;
        st.onchange = () => {
          S.perm = st.state;
          if (!S.dead && st.state === 'granted' && S.phase === 'error' && visible()) start();
        };
      } catch (err) { /* this browser can't watch; Try again still works */ }
    }

    function switchCamera(id) {
      if (!id || S.rec || (id === S.deviceId && S.phase === 'live')) return;
      S.deviceId = id;
      setPref('deviceId', id);
      stopMic();
      start();
    }
    function nextCamera() {
      if (S.devices.length < 2) return;
      const i = S.devices.findIndex(d => d.deviceId === S.deviceId);
      switchCamera(S.devices[(i + 1) % S.devices.length].deviceId);
    }

    /* ---------- showing and hiding: the camera light follows the window ---------- */
    function pause() {
      cancelCountdown();
      if (S.rec) stopRecording('hidden');
      S.gen++;                                  /* a start still waiting on the browser is void */
      stopStream();
      stopMic();
      S.phase = 'paused';
      paint();
    }
    let syncT = 0;
    function sync() {
      if (syncT || S.dead) return;
      syncT = after(0, () => {
        syncT = 0;
        if (S.dead) return;
        if (visible()) {
          if (S.phase === 'paused' || S.phase === 'idle') start();
        } else if (S.stream || S.phase === 'starting' || S.phase === 'idle') {
          pause();
        }
      });
    }

    /* ============================ microphone ============================ */
    async function startMic() {
      if (S.mic || S.micState === 'starting' || S.dead) return;
      const gen = ++S.micGen;
      S.micState = 'starting';
      paintHud();
      try {
        const m = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
        if (gen !== S.micGen || S.dead || S.mode !== 'video' || S.phase !== 'live') { m.getTracks().forEach(t => t.stop()); return; }
        S.mic = m;
        S.micState = 'on';
        startMeter(m);
      } catch (err) {
        if (gen !== S.micGen || S.dead) return;
        S.micErr = err?.name || '';
        S.micState = err?.name === 'NotFoundError' ? 'none'
          : (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') ? 'blocked' : 'failed';
      }
      paintHud();
    }
    function stopMic() {
      S.micGen++;
      stopMeter();
      S.mic?.getTracks().forEach(t => t.stop());
      S.mic = null;
      S.micState = 'off';
    }

    function startMeter(stream) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        const ac = new AC();
        const src = ac.createMediaStreamSource(stream);
        const an = ac.createAnalyser();
        an.fftSize = 1024;
        src.connect(an);
        const buf = new Float32Array(an.fftSize);
        const m = { ac, src, an, raf: 0, last: 0 };
        S.meter = m;
        ac.resume?.()?.catch?.(() => {});
        const loop = now => {
          if (S.meter !== m) return;
          m.raf = requestAnimationFrame(loop);
          if (now - m.last < 70) return;
          m.last = now;
          /* a suspended audio graph reads silence: show no meter rather than a false zero */
          meterEl.hidden = ac.state !== 'running';
          if (meterEl.hidden) { ac.resume?.()?.catch?.(() => {}); return; }
          an.getFloatTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
          const db = 20 * Math.log10(Math.sqrt(sum / buf.length) || 1e-8);
          meterFill.style.transform = `scaleX(${fmt.clamp((db + 60) / 60, 0, 1).toFixed(3)})`;
        };
        m.raf = requestAnimationFrame(loop);
      } catch (err) { /* no meter; recording still has sound */ }
    }
    function stopMeter() {
      const m = S.meter;
      if (!m) return;
      S.meter = null;
      cancelAnimationFrame(m.raf);
      try { m.src.disconnect(); } catch (err) {}
      try { m.ac.close()?.catch?.(() => {}); } catch (err) {}
      meterFill.style.transform = 'scaleX(0)';
      meterEl.hidden = true;
    }

    /* ============================ captures ============================ */
    function flash() {
      if (typeof flashEl.animate !== 'function') return;
      flashEl.animate(reduced()
        ? [{ opacity: 0.22 }, { opacity: 0 }]
        : [{ opacity: 0.92 }, { opacity: 0 }],
      { duration: reduced() ? 160 : 420, easing: 'cubic-bezier(.16,1,.3,1)' });
    }

    function download(blob, name) {
      const url = URL.createObjectURL(blob);
      urls.add(url);
      const a = h('a', { href: url, download: name, style: { display: 'none' } });
      document.body.appendChild(a);
      a.click();
      a.remove();
      after(30000, () => { URL.revokeObjectURL(url); urls.delete(url); });
    }

    async function takePhoto() {
      const w = video.videoWidth, hh = video.videoHeight;
      if (S.phase !== 'live' || !w || !hh) {
        api.notify({ app: 'Camera', icon: 'camera', title: 'No picture yet', message: 'The camera has not sent a frame yet. Try again in a moment.' });
        return;
      }
      const c = document.createElement('canvas');
      c.width = w;
      c.height = hh;
      const g = c.getContext('2d');
      /* with the photo booth in use, the photo is drawn the way its preview is */
      if (booth.applies()) await booth.capture(g, w, hh);
      else paintFrame(g, video, w, hh, lookNow(), S.mirror);
      flash();
      sfx.play('tap');
      const when = new Date();
      const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.92));
      c.width = c.height = 0;
      if (!blob) {
        api.notify({ app: 'Camera', icon: 'alert', title: 'Photo not saved', message: 'The browser could not encode the picture.' });
        return;
      }
      const name = `Photo ${stamp(when)}.${media.extFor(blob.type) || 'jpg'}`;
      try {
        const { path } = await media.save(PHOTOS, name, blob);
        const saved = vfs.baseName(path);
        say(`Photo saved: ${saved}`);
        api.notify({
          app: 'Camera', icon: 'camera', title: 'Photo saved',
          message: `${saved} · ${w}×${hh} · ${fmt.fmtBytes(blob.size)}`,
          actions: [
            { label: 'Open', onClick: () => api.openFile(path) },
            { label: 'Show in Files', onClick: () => api.openApp('files', { path: PHOTOS }) },
          ],
          /* on a phone the toast sits over the shutter; the filmstrip already shows the photo */
          timeout: document.body.classList.contains('is-mobile') ? 3000 : 6000,
        });
      } catch (err) {
        api.notify({
          app: 'Camera', icon: 'alert', title: 'Photo not saved', message: `${err?.message || err} You can still download it.`,
          actions: [{ label: 'Download', onClick: () => download(blob, name) }], timeout: 15000,
        });
      }
    }

    /* A look or mirroring goes through a canvas so the recording matches the
       viewfinder; one canvas frame per camera frame. */
    function makePipe(look, mirror) {
      const w = video.videoWidth, hh = video.videoHeight;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = hh;
      if (typeof c.captureStream !== 'function') return null;
      const g = c.getContext('2d', { alpha: false });
      paintFrame(g, video, w, hh, look, mirror);
      const out = c.captureStream();
      let alive = true, handle = 0;
      const rvfc = typeof video.requestVideoFrameCallback === 'function';
      const draw = () => {
        if (!alive) return;
        paintFrame(g, video, w, hh, look, mirror);
        handle = rvfc ? video.requestVideoFrameCallback(draw) : requestAnimationFrame(draw);
      };
      handle = rvfc ? video.requestVideoFrameCallback(draw) : requestAnimationFrame(draw);
      return {
        stream: out,
        stop() {
          alive = false;
          if (rvfc) video.cancelVideoFrameCallback?.(handle); else cancelAnimationFrame(handle);
          out.getTracks().forEach(t => t.stop());
          c.width = c.height = 0;
        },
      };
    }

    function startRecording() {
      const type = recorderType();
      if (type === null || S.phase !== 'live' || !S.stream || !video.videoWidth) return;
      const look = lookNow();
      const needPipe = S.mirror || look.id !== 'natural';
      const pipe = needPipe ? makePipe(look, S.mirror) : null;
      const vt = pipe ? pipe.stream.getVideoTracks() : S.stream.getVideoTracks();
      const at = S.mic ? S.mic.getAudioTracks().filter(t => t.readyState === 'live') : [];
      let rec;
      try {
        rec = new MediaRecorder(new MediaStream([...vt, ...at]), type ? { mimeType: type } : undefined);
      } catch (err) {
        pipe?.stop();
        api.notify({ app: 'Camera', icon: 'alert', title: 'Recording couldn\'t start', message: `${err?.name || 'Error'}: ${err?.message || ''}` });
        return;
      }
      const R = {
        rec, pipe, chunks: [], bytes: 0, t0: performance.now(), when: new Date(),
        sound: at.length > 0, type: rec.mimeType || type || 'video/webm', error: null,
        w: video.videoWidth, h: video.videoHeight,
      };
      R.stopped = new Promise(res => { rec.onstop = res; });
      rec.ondataavailable = e => {
        if (e.data && e.data.size) { R.chunks.push(e.data); R.bytes += e.data.size; paintRec(); }
      };
      rec.onerror = e => { R.error = e?.error || e; if (S.rec === R) stopRecording('error'); };
      try { rec.start(1000); } catch (err) {
        pipe?.stop();
        api.notify({ app: 'Camera', icon: 'alert', title: 'Recording couldn\'t start', message: `${err?.name || 'Error'}: ${err?.message || ''}` });
        return;
      }
      S.rec = R;
      R.tick = setInterval(paintRec, 250);
      say('Recording started');
      paint();
      paintRec();
    }

    function paintRec() {
      const R = S.rec;
      if (!R) return;
      const sec = (performance.now() - R.t0) / 1000;
      recTime.textContent = `REC ${fmt.fmtDur(sec)}${R.bytes ? ` · ${fmt.fmtBytes(R.bytes)}` : ''}`;
    }

    async function stopRecording(why) {
      const R = S.rec;
      if (!R) return;
      S.rec = null;
      clearInterval(R.tick);
      const ms = performance.now() - R.t0;
      try { if (R.rec.state !== 'inactive') R.rec.stop(); } catch (err) {}
      if (!S.dead) paint();
      let wait = 0;
      await Promise.race([R.stopped, new Promise(res => { wait = setTimeout(res, 4000); })]);
      clearTimeout(wait);
      R.pipe?.stop();
      let blob = new Blob(R.chunks, { type: R.type });
      R.chunks = [];
      if (!blob.size) {
        api.notify({ app: 'Camera', icon: 'alert', title: 'Nothing was recorded',
          message: R.error ? `The recorder stopped: ${R.error.name || R.error.message || R.error}` : 'The recording was too short to keep.' });
        return;
      }
      /* the length players will show: measured from the recording itself, the clock as a fallback */
      const len = (await mediaLength(blob)) ?? ms;
      if (/webm/i.test(blob.type)) blob = await withDuration(blob, len);
      const name = `Video ${stamp(R.when)}.${media.extFor(blob.type) || (/mp4/i.test(blob.type) ? 'mp4' : 'webm')}`;
      const why2 = why === 'hidden' ? 'Recording stopped because the Camera window was hidden. '
        : why === 'closed' ? 'Recording stopped because the Camera window closed. '
          : why === 'ended' ? 'Recording stopped because the camera stopped. '
            : why === 'error' ? 'The recorder hit an error; this is what it kept. ' : '';
      try {
        const saved = await media.save(VIDEOS, name, blob);
        const id = saved.id;
        const made = (pref('made', []) || []).filter(x => x !== id);
        setPref('made', [...made, id].slice(-200));
        const fname = vfs.baseName(saved.path);
        if (!S.dead) say(`Video saved: ${fname}`);
        api.notify({
          app: 'Camera', icon: 'video', title: 'Video saved',
          message: `${why2}${fname} · ${fmt.fmtDur(len / 1000)} · ${fmt.fmtBytes(blob.size)}${R.sound ? '' : ' · no sound'}`,
          actions: [
            { label: 'Open', onClick: () => api.openFile(saved.path) },
            { label: 'Show in Files', onClick: () => api.openApp('files', { path: VIDEOS }) },
          ],
          timeout: why2 ? 12000 : 6000,
        });
      } catch (err) {
        api.notify({
          app: 'Camera', icon: 'alert', title: 'Video not saved', message: `${err?.message || err} You can still download it.`,
          actions: [{ label: 'Download', onClick: () => download(blob, name) }], timeout: 20000,
        });
      }
    }

    /* ---------- the shutter ---------- */
    function fire() {
      if (S.count) { cancelCountdown(); say('Self-timer cancelled'); return; }
      if (S.rec) { stopRecording('user'); return; }
      if (S.phase !== 'live') return;
      if (S.mode === 'video' && !canRecord()) return;
      const act = () => { if (S.phase === 'live') (S.mode === 'video' ? startRecording : takePhoto)(); };
      if (S.timer) startCountdown(act); else act();
    }

    function startCountdown(then) {
      S.count = { n: S.timer, t: 0 };
      say(`${S.timer} second timer`);
      paintCount();
      const tick = () => {
        if (!S.count) return;
        S.count.n -= 1;
        if (S.count.n <= 0) { S.count = null; paintCount(); then(); return; }
        paintCount();
        S.count.t = after(1000, tick);
      };
      S.count.t = after(1000, tick);
    }
    function cancelCountdown() {
      if (!S.count) return;
      clearTimeout(S.count.t);
      timers.delete(S.count.t);
      S.count = null;
      paintCount();
    }

    /* ---------- settings ---------- */
    function setMode(m) {
      if (m === S.mode || S.rec) return;
      cancelCountdown();
      S.mode = m;
      setPref('mode', m);
      if (m === 'video' && S.phase === 'live') startMic(); else stopMic();
      paint();
    }
    function setLook(id) {
      if (S.rec) return;
      S.look = lookById(id).id;
      setPref('look', S.look);
      paintView(); paintLooks(); paintDeck();
    }
    function toggleLooks() {
      S.looksOpen = !S.looksOpen;
      setPref('looksOpen', S.looksOpen);
      if (S.looksOpen) booth.close();           /* one panel under the picture at a time */
      paintLooks(); paintDeck();
    }
    function toggleGrid() {
      S.grid = !S.grid;
      setPref('grid', S.grid);
      paintView(); paintTools();
    }
    function toggleMirror() {
      if (S.rec) return;
      S.mirror = !S.mirror;
      if (S.deviceId) {
        const map = { ...(pref('mirror', {}) || {}) };
        delete map[S.deviceId];
        const keys = Object.keys(map);
        if (keys.length > 7) delete map[keys[0]];
        setPref('mirror', { ...map, [S.deviceId]: S.mirror });
      }
      paintView(); paintTools();
    }
    function cycleTimer() {
      if (S.rec) return;
      cancelCountdown();
      const list = [0, 3, 10];
      S.timer = list[(list.indexOf(S.timer) + 1) % list.length];
      paintDeck(); paintHud();
    }

    /* ============================ filmstrip ============================ */
    const tiles = new Map();            /* path -> { el, key, vid } */

    function captures() {
      const made = new Set(pref('made', []) || []);
      const out = [];
      for (const n of vfs.ls(PHOTOS)) {
        if (n.type === 'file' && (n.kind === 'image' || n.kind === 'video')) out.push({ path: `${PHOTOS}/${n.name}`, node: n });
      }
      for (const n of vfs.ls(VIDEOS)) {
        if (n.type !== 'file' || n.kind !== 'video' || typeof n.content !== 'string' || !n.content.startsWith(media.MEDIA)) continue;
        if (made.has(n.content.slice(media.MEDIA.length)) || /^Video \d{4}-\d{2}-\d{2} /.test(n.name)) out.push({ path: `${VIDEOS}/${n.name}`, node: n });
      }
      return out.sort((a, b) => new Date(b.node.mtime) - new Date(a.node.mtime));
    }

    function dropTile(path) {
      const t = tiles.get(path);
      if (!t) return;
      if (t.vid) { t.vid.removeAttribute('src'); try { t.vid.load(); } catch (err) {} }
      tiles.delete(path);
    }

    function tileFor({ path, node }) {
      const key = `${node.name}|${node.content}|${node.mtime}`;
      const had = tiles.get(path);
      if (had && had.key === key) return had.el;
      dropTile(path);
      const isVid = node.kind === 'video';
      const thumb = h('span.cam-tile__img');
      const dur = h('span');
      const rec = { el: null, key, vid: null };
      const menu = e => {
        e.preventDefault();
        const x = e.clientX || rec.el.getBoundingClientRect().left, y = e.clientY || rec.el.getBoundingClientRect().top;
        api.menu([
          { label: 'Open', icon: 'external-link', onClick: () => api.openFile(path) },
          { label: 'Show in Files', icon: 'folder-open', onClick: () => api.openApp('files', { path: vfs.parentPath(path) }) },
          { label: 'Download', icon: 'download', disabled: !media.isMedia(node),
            onClick: async () => { const b = await media.blobOf(node); if (b) download(b, node.name); } },
          '-',
          { label: 'Move to Trash', icon: 'trash', danger: true, onClick: () => { vfs.rm(path); } },
        ], x, y);
      };
      const size = node.size ? ` · ${fmt.fmtBytes(node.size)}` : '';
      rec.el = h('button.cam-tile', {
        type: 'button', title: `${node.name}${size}`, 'aria-label': `Open ${node.name}${size}`,
        onclick: () => api.openFile(path), oncontextmenu: menu,
      }, thumb, isVid ? h('span.cam-tile__badge', camGlyph(), dur) : null);
      const empty = label => {
        rec.el.classList.add('is-empty');
        api.render(thumb, icon(isVid ? 'film' : 'image'), h('small', { text: label }));
        rec.el.title = `${node.name} — ${label.toLowerCase()}`;
      };
      if (!media.isMedia(node)) empty('No data');
      else {
        media.urlOf(node).then(url => {
          if (S.dead || tiles.get(path) !== rec) return;
          if (!url) { empty('Missing'); return; }
          if (isVid) {
            const v = h('video', { muted: true, playsinline: true, preload: 'metadata', 'aria-hidden': 'true', src: url });
            v.muted = true;
            v.addEventListener('loadedmetadata', () => {
              if (Number.isFinite(v.duration) && v.duration > 0) dur.textContent = fmt.fmtDur(v.duration);
              try { v.currentTime = Math.min(0.1, (v.duration || 1) / 2); } catch (err) {}
            }, { once: true });
            v.addEventListener('error', () => empty('Can\'t play'), { once: true });
            rec.vid = v;
            thumb.append(v);
          } else {
            const img = h('img', { alt: '', src: url, decoding: 'async', draggable: 'false' });
            img.addEventListener('error', () => empty('Can\'t open'), { once: true });
            thumb.append(img);
          }
        }, () => empty('Missing'));
      }
      tiles.set(path, rec);
      return rec.el;
    }

    const CAP = 30;
    let emptyEl = null, moreEl = null;
    function paintStrip() {
      if (S.dead) return;
      const items = captures();
      const keep = new Set(items.slice(0, CAP).map(i => i.path));
      for (const p of [...tiles.keys()]) if (!keep.has(p)) dropTile(p);
      let kids;
      if (!items.length) {
        emptyEl = emptyEl || h('div.cam__empty', icon('image'),
          h('span', { text: 'No captures yet — photos are saved to Pictures › Camera, videos to Videos.' }));
        kids = [emptyEl];
      } else {
        const photos = items.filter(i => i.node.kind === 'image').length, vids = items.length - photos;
        const count = [photos && `${photos} photo${photos === 1 ? '' : 's'}`, vids && `${vids} video${vids === 1 ? '' : 's'}`].filter(Boolean).join(', ');
        allCount.textContent = String(items.length);
        allBtn.title = `${count} — show in Files`;
        allBtn.setAttribute('aria-label', `${count}. Show in Files`);
        allBtn.onclick = () => api.openApp('files', { path: photos || !vids ? PHOTOS : VIDEOS });
        kids = [allBtn, ...items.slice(0, CAP).map(tileFor)];
        if (items.length > CAP) {
          moreEl = moreEl || h('button.cam-tile.cam-tile--more', { type: 'button', onclick: () => api.openApp('files', { path: PHOTOS }) },
            h('span'), h('small', { text: 'in Files' }));
          moreEl.firstChild.textContent = `+${items.length - CAP}`;
          moreEl.setAttribute('aria-label', `${items.length - CAP} more — show in Files`);
          kids.push(moreEl);
        }
      }
      /* move nothing that is already in place, so only a new capture animates in */
      kids.forEach((k, i) => { if (strip.children[i] !== k) strip.insertBefore(k, strip.children[i] || null); });
      while (strip.children.length > kids.length) strip.lastElementChild.remove();
    }
    let stripT = 0;
    const paintStripSoon = () => {
      if (stripT) return;
      stripT = after(60, () => { stripT = 0; paintStrip(); });
    };

    /* ============================ wiring ============================ */
    const isOurs = p => typeof p === 'string' && (p === PHOTOS || p === VIDEOS || p.startsWith(`${PHOTOS}/`) || p.startsWith(`${VIDEOS}/`));
    offs.push(bus.on('fs:change', (dir, path) => { if (isOurs(dir) || isOurs(path)) paintStripSoon(); }));
    offs.push(bus.on('media:change', e => { if (isOurs(e?.path)) paintStripSoon(); }));
    for (const ev of ['win:minimize', 'win:restore', 'win:focus', 'win:list']) offs.push(bus.on(ev, sync));
    offs.push(bus.on('season:change', () => paint()));   /* the booth comes and goes with the season */
    const onVis = () => sync();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('resize', onVis);
    const onDevices = () => refreshDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', onDevices);
    const onMeta = () => {
      if (S.track) S.settings = S.track.getSettings?.() || S.settings;
      paintView(); paintHud();
    };
    video.addEventListener('loadedmetadata', onMeta);
    video.addEventListener('resize', onMeta);

    const onKey = e => {
      if (S.dead || !win.el.classList.contains('is-active') || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && t !== document.body && !win.el.contains(t)) return;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.key === 'Escape' && S.count) { e.preventDefault(); cancelCountdown(); say('Self-timer cancelled'); return; }
      if (e.code === 'Space' || e.key === ' ') {
        if (t && t.tagName === 'BUTTON') return;          /* Space presses the focused button */
        e.preventDefault();
        if (!e.repeat) fire();
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 'g') { e.preventDefault(); toggleGrid(); }
      else if (k === 'm') { e.preventDefault(); toggleMirror(); }
      else if (k === 't') { e.preventDefault(); cycleTimer(); }
    };
    window.addEventListener('keydown', onKey);

    win.onReopen(o => { if (o?.mode === 'photo' || o?.mode === 'video') setMode(o.mode); });

    paint();
    paintCount();
    paintStrip();
    sync();

    return () => {
      if (S.dead) return;
      cancelCountdown();
      if (S.rec) stopRecording('closed');          /* finishes and saves on its own */
      S.dead = true;
      S.gen++;
      booth.destroy();
      stopStream();
      stopMic();
      if (S.permStatus) S.permStatus.onchange = null;
      offs.forEach(off => off());
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('resize', onVis);
      navigator.mediaDevices?.removeEventListener?.('devicechange', onDevices);
      video.removeEventListener('loadedmetadata', onMeta);
      video.removeEventListener('resize', onMeta);
      window.removeEventListener('keydown', onKey);
      timers.forEach(clearTimeout);
      timers.clear();
      for (const p of [...tiles.keys()]) dropTile(p);
      urls.forEach(u => URL.revokeObjectURL(u));
      urls.clear();
    };
  },
});
