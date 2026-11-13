/* ============================================================
   recorder.js — Static Recorder: a real voice recorder.

   Record: the big button asks for the microphone (getUserMedia,
   audio only) and records it with MediaRecorder in the first
   container this browser can write — Opus in WebM, Opus in Ogg,
   AAC in MP4 — at 96 kbps. While it runs, the waveform and the
   level meter are an AnalyserNode on that same stream, the clock
   counts only time actually recorded (pauses left out), and the
   byte count is what the recorder has handed back so far. Pause
   is offered only where MediaRecorder has it. Starting a take
   pauses Music, so the song doesn't end up in the memo.

   Stop keeps a real file. The take is decoded once (an 8 kHz
   OfflineAudioContext) to measure its exact length and draw its
   waveform; a WebM gets that length written into its header (a
   live MediaRecorder leaves it out, so players show ∞ and can't
   seek); and media.save() puts it in ~/Music with the extension
   its first bytes call for (.weba / .ogg / .m4a). The vfs maps
   neither .weba nor .m4a to 'audio', so the node's kind is set to
   'audio' — double-clicking it in Files opens Music, and Music
   lists it with everything else.

   The list is exactly the files this recorder made. Their media
   ids live in store('portal.recorder') and every file-system
   change re-finds them by that id, so a rename or a move in Files
   follows the file, one in the Trash drops off the list (and comes
   back if it is restored), and one deleted for good is forgotten.
   Each plays here (seek, ±5 s, speed), renames in place,
   downloads, opens in Music or Files, and moves to the Trash with
   an Undo.

   The microphone light is a promise: every track stops the moment
   a take stops or is discarded, and when the window closes — a
   take still running is then finished, saved, and announced in a
   notification. What the browser won't do is said plainly: not a
   secure page, no getUserMedia, no MediaRecorder, access blocked
   (with how to allow it in this browser and this OS), no
   microphone, microphone busy, and takes under one second, which
   are not kept. Nothing on screen is sample data.

   Screen. The Voice | Screen switch turns the same deck into a
   screen recorder: getDisplayMedia asks the browser's own picker
   what to share (a tab, a window, the screen), the shared sound and
   — with "Narrate with microphone" on — your voice are mixed into
   one track, and MediaRecorder writes WebM video (MP4 where that is
   all it can write) into ~/Videos. The browser's "Stop sharing"
   button ends the take the same way Stop does.

   Editing a video. A video in the list opens in the editor: a
   filmstrip timeline with trim handles and a playhead (drag them, or
   use the arrow keys), start/end fields, a caption (text, top /
   middle / bottom, and the time range it shows for), a Preview that
   plays only the cut with the caption laid over it exactly as it
   will be burnt in, and Export, which re-encodes the cut in this
   browser (core/videocut.js: the cut plays through once, in real
   time, into a canvas + MediaRecorder) and saves it next to the
   original as "<name> (edited).webm". The original is only read.

   Voice effects. A voice recording also has a "Voice effects" card
   (recorder-fx.js, DSP in core/voicefx.js): robot, chipmunk, deep,
   echo, reverb and radio, rendered offline, previewed, and saved as a
   new WAV or WebM/Opus file next to it. The recording is only read.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as media from '../core/media.js';
import * as db from '../core/db.js';
import * as VC from '../core/videocut.js';
import { createFxPanel } from './recorder-fx.js';

/* self-injected stylesheet, guarded so re-opening never double-adds it */
if (typeof document !== 'undefined' && !document.getElementById('feat-recorder-css')) {
  const l = document.createElement('link');
  l.id = 'feat-recorder-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-recorder.css';
  document.head.appendChild(l);
}

const APP = 'Static Recorder';
const STORE_KEY = 'portal.recorder';
const NARROW = 600;                 /* painted width below which one pane shows at a time */
const MIN_MS = 1000;                /* a take shorter than this is not kept */
const BUCKET_MS = 50;               /* live waveform: one bar per 50 ms recorded */
const PITCH = 3;                    /* css px per waveform bar: a 2 px bar and a 1 px gap */
const FLOOR_DB = -54;               /* the waveform's silence floor */
const METER_DB = -60;               /* the level meter reads -60 … 0 dBFS */
const PEAKS = 240;                  /* waveform points kept per recording */
const DECODE_MAX_MS = 20 * 60 * 1000;
const BITRATE = 96000;
const LEVELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const SPEEDS = [1, 1.5, 2, 0.75];
const MIN_CUT = 0.5;                /* s — the shortest cut the editor makes */
const NUDGE = 0.1, NUDGE_BIG = 1;   /* s per arrow key (and with Shift) in the editor */
const TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm', 'audio/ogg'];

/* ---------------- small helpers ---------------- */
const pad2 = n => String(n).padStart(2, '0');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const stemOf = name => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(0, i) : name; };
const extOf = name => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(i + 1).toLowerCase() : ''; };
const stamp = (d = new Date()) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}.${pad2(d.getMinutes())}.${pad2(d.getSeconds())}`;
const bytes = n => {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
};
const minus = n => String(n).replace('-', '−');

/** 0:07 · 12:04 · 1:02:03, with tenths when asked (0:07.4) */
function clock(ms, tenths = false) {
  const t = Math.max(0, Number(ms) || 0);
  const whole = Math.floor(t / 1000);
  const hh = Math.floor(whole / 3600), m = Math.floor((whole % 3600) / 60), s = whole % 60;
  const base = hh ? `${hh}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
  return tenths ? `${base}.${Math.floor((t % 1000) / 100)}` : base;
}
/** "12.4 seconds" for short takes, a clock for long ones */
const lengthText = ms => (ms < 60000 ? `${(Math.floor(ms / 100) / 10).toFixed(1)} seconds` : clock(ms));

/** "Today, 2:02 PM", "Yesterday, …", "Monday, …", "Sep 12" */
function whenText(iso, h24) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: !h24 });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(d); that.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - that.getTime()) / 86400000);
  if (diff === 0) return `Today, ${time}`;
  if (diff === 1) return `Yesterday, ${time}`;
  if (diff > 1 && diff < 7) return `${d.toLocaleDateString(undefined, { weekday: 'long' })}, ${time}`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

/** A device label short enough for one line ("USB Mic (0c45:6a1d)" → "USB Mic"). */
function shortLabel(label) {
  const s = String(label || '').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim();
  return s.length > 60 ? `${s.slice(0, 59)}…` : s;
}

/* ---------------- levels and waveforms ---------------- */
const dbOf = amp => (amp > 0 ? 20 * Math.log10(amp) : -Infinity);
const levelOf = amp => clamp((dbOf(amp) - FLOOR_DB) / -FLOOR_DB, 0, 1);
const encodePeaks = arr => arr.map(v => LEVELS[clamp(Math.round((v || 0) * 63), 0, 63)]).join('');
const decodePeaks = s => Array.from(String(s || ''), ch => Math.max(0, LEVELS.indexOf(ch)) / 63);

/** Max-pool (or stretch) a list of 0…1 values to n points; a missing reading counts as silence. */
function resample(values, n) {
  const out = new Array(n).fill(0);
  const len = values.length;
  if (!len) return out;
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i * len) / n);
    const b = Math.max(a + 1, Math.floor(((i + 1) * len) / n));
    let m = 0;
    for (let j = a; j < b && j < len; j++) if ((values[j] || 0) > m) m = values[j];
    out[i] = m;
  }
  return out;
}

/* ---------------- what this browser can record ---------------- */
/** The first container MediaRecorder can write; '' = let it choose; null = it can't record. */
function recorderType() {
  if (typeof MediaRecorder !== 'function') return null;
  if (typeof MediaRecorder.isTypeSupported !== 'function') return '';
  for (const t of TYPES) {
    try { if (MediaRecorder.isTypeSupported(t)) return t; } catch (err) { /* keep looking */ }
  }
  return '';
}

const BOX = { weba: 'WebM', ogg: 'Ogg', m4a: 'MPEG-4', mp3: 'MP3', wav: 'WAV', aac: 'AAC' };
const EXT_BY_MIME = { 'audio/webm': 'weba', 'video/webm': 'weba', 'audio/ogg': 'ogg', 'application/ogg': 'ogg',
  'audio/mp4': 'm4a', 'video/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/mpeg': 'mp3',
  'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav' };
const MIME_BY_EXT = { weba: 'audio/webm', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', mp3: 'audio/mpeg', wav: 'audio/wav' };

/** "Opus audio in WebM" — the codec from the recorder's MIME type, the container from the bytes. */
function describe(mime, ext) {
  const m = String(mime || '').toLowerCase();
  const codec = /opus/.test(m) ? 'Opus' : /mp4a|aac/.test(m) ? 'AAC' : /vorbis/.test(m) ? 'Vorbis' : /pcm/.test(m) ? 'PCM' : '';
  const box = BOX[ext] || String(ext || 'audio').toUpperCase();
  return codec && codec !== box ? `${codec} audio in ${box}` : `${box} audio`;
}

/** "VP9 video in WebM" — the codec from the recorder's MIME type, the container from the bytes. */
function describeVideo(mime, ext) {
  const m = String(mime || '').toLowerCase();
  const codec = /vp9/.test(m) ? 'VP9' : /vp8/.test(m) ? 'VP8' : /av01|av1/.test(m) ? 'AV1' : /avc1|h264/.test(m) ? 'H.264' : '';
  const box = ext === 'mp4' ? 'MP4' : 'WebM';
  return codec ? `${codec} video in ${box}` : `${box} video`;
}
/** webm or mp4, from the first bytes of a video take */
async function sniffVideo(blob) {
  let b = new Uint8Array(0);
  try { b = new Uint8Array(await blob.slice(0, 12).arrayBuffer()); } catch (err) { /* fall back to the type */ }
  const mp4 = b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70;
  const webm = b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
  const ext = mp4 ? 'mp4' : webm ? 'webm' : (/mp4/.test(blob.type) ? 'mp4' : 'webm');
  return { ext, mime: ext === 'mp4' ? 'video/mp4' : 'video/webm' };
}

/** Which file this really is, read from its first bytes (the MIME type only as a fallback). */
async function sniff(blob) {
  let b = new Uint8Array(0);
  try { b = new Uint8Array(await blob.slice(0, 16).arrayBuffer()); } catch (err) { /* fall back to the type */ }
  const at = (i, ...xs) => xs.every((x, k) => b[i + k] === x);
  let ext = null;
  if (at(0, 0x1a, 0x45, 0xdf, 0xa3)) ext = 'weba';
  else if (at(0, 0x4f, 0x67, 0x67, 0x53)) ext = 'ogg';
  else if (at(4, 0x66, 0x74, 0x79, 0x70)) ext = 'm4a';
  else if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x41, 0x56, 0x45)) ext = 'wav';
  else if (at(0, 0x49, 0x44, 0x33) || (b[0] === 0xff && (b[1] & 0xe6) === 0xe2)) ext = 'mp3';
  else if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) ext = 'aac';
  if (!ext) {
    const base = String(blob.type || '').split(';')[0].trim().toLowerCase();
    const viaMedia = media.extFor(base);
    ext = (viaMedia && media.kindOf(viaMedia) === 'audio' ? viaMedia : null) || EXT_BY_MIME[base] || 'weba';
  }
  return { ext, mime: MIME_BY_EXT[ext] || 'audio/webm' };
}

/* The WebM length fix (withDuration) lives in core/videocut.js, shared with the video cut. */
const withDuration = VC.withDuration;

/** Decode once, at 8 kHz, for the exact length and a waveform. null if the browser can't. */
async function analyse(blob) {
  const OAC = typeof window !== 'undefined' && (window.OfflineAudioContext || window.webkitOfflineAudioContext);
  if (!OAC) return null;
  let ab;
  try { ab = await blob.arrayBuffer(); } catch (err) { return null; }
  for (const rate of [8000, 22050, 44100]) {
    let buf = null;
    try {
      const ac = new OAC(1, 1, rate);
      buf = await new Promise((res, rej) => {
        const p = ac.decodeAudioData(ab.slice(0), res, rej);
        if (p && typeof p.then === 'function') p.then(res, rej);
      });
    } catch (err) { buf = null; }
    if (!buf || !buf.length) continue;
    const chans = [];
    for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
    const len = buf.length, out = new Array(PEAKS);
    for (let i = 0; i < PEAKS; i++) {
      const a = Math.floor((i * len) / PEAKS), e = Math.min(len, Math.max(a + 1, Math.floor(((i + 1) * len) / PEAKS)));
      let m = 0;
      for (const ch of chans) for (let j = a; j < e; j++) { const v = ch[j] < 0 ? -ch[j] : ch[j]; if (v > m) m = v; }
      out[i] = levelOf(m);
    }
    return { ms: buf.duration * 1000, peaks: encodePeaks(out) };
  }
  return null;
}

/** Hand a Blob to the browser as a download. `reg` lets a window revoke it on close. */
function downloadBlob(blob, name, reg) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  const t = setTimeout(() => {
    URL.revokeObjectURL(url);
    if (reg) { reg.urls.delete(url); reg.timers.delete(t); }
  }, 30000);
  if (reg) { reg.urls.add(url); reg.timers.add(t); }
}

/* ---------------- plain-language problems ---------------- */
function siteHelp() {
  const ua = navigator.userAgent || '';
  if (/Firefox\//.test(ua)) return 'Firefox is blocking the microphone for this site. Click the permissions icon at the left end of the address bar, clear the “Blocked” microphone setting, then press Try again.';
  if (/Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg\//.test(ua)) return 'Safari is blocking the microphone for this site. Choose Safari › Settings for This Website… (on iPhone or iPad, tap “aA” › Website Settings), set Microphone to Allow, then press Try again.';
  return 'The browser is blocking the microphone for this site. Click the site-settings icon at the left end of the address bar (or the crossed-out microphone at the right), set Microphone to Allow, then press Try again.';
}
function osHelp() {
  const ua = navigator.userAgent || '';
  if (/Windows/.test(ua)) return 'Windows is not letting this browser use the microphone. Open Settings › Privacy & security › Microphone, turn on microphone access and “Let desktop apps access your microphone”, then press Try again.';
  if (/Mac/.test(ua)) return 'macOS is not letting this browser use the microphone. Open System Settings › Privacy & Security › Microphone, turn your browser on (it may ask to restart), then press Try again.';
  return 'The computer is not letting this browser use the microphone. Allow microphone access for the browser in the system settings, then press Try again.';
}
/** What went wrong with getUserMedia, in words a person can act on. */
function micProblem(err) {
  const name = err?.name || '';
  const msg = String(err?.message || '');
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    if (/system/i.test(msg)) return { kind: 'os', icon: 'lock', title: 'Your computer is blocking the microphone', body: osHelp() };
    if (/dismiss/i.test(msg)) return { kind: 'dismissed', icon: 'mic', title: 'Microphone permission not given', body: 'The browser asked to use the microphone and the question was closed without an answer. Press Allow microphone to be asked again.', action: 'Allow microphone' };
    return { kind: 'denied', icon: 'lock', title: 'Microphone access is blocked', body: siteHelp() };
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return { kind: 'nomic', icon: 'mic', title: 'No microphone found', body: 'This device has no microphone the browser can see. Plug one in or switch on a headset, then press Try again.' };
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return { kind: 'busy', icon: 'alert', title: 'The microphone is busy', body: 'Another app or tab is using it, or it stopped responding. Close the other app (video calls often hold on to it), then press Try again.' };
  }
  return { kind: 'failed', icon: 'alert', title: 'The microphone couldn’t start',
    body: `The browser said: “${msg || 'no details'}” (${name || 'Error'}). Press Try again; if it keeps happening, reload StaticOS or restart the browser.` };
}
/** What went wrong with getDisplayMedia, in words a person can act on. */
function screenProblem(err) {
  const name = err?.name || '';
  const msg = String(err?.message || '');
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    if (/system/i.test(msg)) {
      const ua = navigator.userAgent || '';
      return { kind: 'os', icon: 'lock', title: 'Your computer is blocking screen recording',
        body: /Mac/.test(ua) ? 'macOS is not letting this browser record the screen. Open System Settings › Privacy & Security › Screen & System Audio Recording, turn your browser on (it may ask to restart), then press Try again.'
          : 'The computer is not letting this browser record the screen. Allow screen recording for the browser in the system settings, then press Try again.' };
    }
    return { kind: 'dismissed', icon: 'monitor', title: 'Nothing was shared', body: 'The browser asked what to share and the question was closed, or sharing is blocked for this site. Press Record to be asked again and pick a tab, a window or the screen.', action: 'Choose what to share' };
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return { kind: 'busy', icon: 'alert', title: 'The screen couldn’t be captured', body: 'The browser or the system refused to start the capture. Close other screen-sharing apps, then press Try again.' };
  }
  return { kind: 'failed', icon: 'alert', title: 'Screen recording couldn’t start',
    body: `The browser said: “${msg || 'no details'}” (${name || 'Error'}). Press Try again; if it keeps happening, reload StaticOS.` };
}

/** Things no button press can fix, checked before asking for anything. */
function precheck(mode = 'voice') {
  if (mode === 'screen') {
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      return { kind: 'insecure', icon: 'lock', retry: false, title: 'Screen recording needs a secure page',
        body: `Browsers only let a page record the screen over https:// (or on localhost). This page is ${location.protocol}//${location.host}. Open StaticOS over https to record.` };
    }
    if (typeof navigator === 'undefined' || !navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
      return { kind: 'nogdm', icon: 'monitor', retry: false, title: 'This browser can’t record the screen',
        body: 'navigator.mediaDevices.getDisplayMedia is missing here — phones and tablets don’t offer it. A desktop Chrome, Edge, Firefox or Safari can. Videos already in the list still open in the editor.' };
    }
    if (VC.videoRecorderType() === null) {
      return { kind: 'norec', icon: 'alert', retry: false, title: 'This browser can’t record video',
        body: 'MediaRecorder can’t write a video format here, so a screen recording can’t be turned into a file.' };
    }
    return null;
  }
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return { kind: 'insecure', icon: 'lock', retry: false, title: 'The microphone needs a secure page',
      body: `Browsers only let a page use the microphone over https:// (or on localhost). This page is ${location.protocol}//${location.host}, so recording can’t start here. Open StaticOS over https to record.` };
  }
  if (typeof navigator === 'undefined' || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    return { kind: 'nogum', icon: 'mic', retry: false, title: 'This browser can’t use a microphone',
      body: 'navigator.mediaDevices.getUserMedia is missing here, so there is no way to hear the microphone. A current Chrome, Edge, Firefox or Safari can record. Recordings already in the list still play.' };
  }
  if (recorderType() === null) {
    return { kind: 'norec', icon: 'alert', retry: false, title: 'This browser can’t record audio',
      body: 'MediaRecorder is missing here, so the microphone can’t be turned into a file. A current Chrome, Edge, Firefox or Safari can record. Recordings already in the list still play.' };
  }
  return null;
}

/* ---------------- the saved list: treat the store as untrusted ---------------- */
function normItem(o) {
  if (!o || typeof o !== 'object' || typeof o.id !== 'string' || !/^[\w-]{4,80}$/.test(o.id)) return null;
  const num = (v, min = 0) => (Number.isFinite(v) && v >= min ? v : 0);
  return {
    id: o.id,
    path: typeof o.path === 'string' ? o.path.slice(0, 600) : '',
    ms: num(o.ms),
    size: num(o.size),
    mime: typeof o.mime === 'string' ? o.mime.slice(0, 80) : '',
    fmt: typeof o.fmt === 'string' ? o.fmt.slice(0, 60) : '',
    at: typeof o.at === 'string' && !Number.isNaN(Date.parse(o.at)) ? o.at : '',
    peaks: typeof o.peaks === 'string' ? o.peaks.replace(/[^A-Za-z0-9_-]/g, '').slice(0, PEAKS) : '',
    rate: num(o.rate),
    ch: num(o.ch),
    mic: typeof o.mic === 'string' ? o.mic.slice(0, 80) : '',
    kind: o.kind === 'video' ? 'video' : 'audio',
    w: num(o.w), h: num(o.h),
    aud: o.aud === true,
    src: typeof o.src === 'string' && /^[\w-]{4,80}$/.test(o.src) ? o.src : '',
  };
}
function normData(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const seen = new Set();
  const items = (Array.isArray(d.items) ? d.items : []).map(normItem)
    .filter(it => it && !seen.has(it.id) && seen.add(it.id));
  return { v: 1, items, deviceId: typeof d.deviceId === 'string' ? d.deviceId.slice(0, 300) : '', voice: d.voice !== false,
    source: d.source === 'screen' ? 'screen' : 'voice', narrate: d.narrate === true };
}

/* ======================================================================== */

defineApp({
  id: 'recorder',
  name: 'Static Recorder',
  icon: 'mic',
  g1: '#ff7a6b', g2: '#b3122e',
  category: 'Media',
  keywords: ['voice', 'memo', 'memos', 'voice memo', 'record', 'recorder', 'recording', 'audio', 'microphone', 'mic',
    'dictaphone', 'dictation', 'sound', 'podcast', 'interview', 'lecture', 'notes',
    'screen recording', 'screen recorder', 'record screen', 'video', 'trim', 'cut', 'caption', 'subtitle', 'edit video', 'video editor'],
  desc: 'Record your voice or your screen; trim and caption screen recordings',
  singleton: true,
  win: { w: 820, h: 580, minW: 380, minH: 440 },

  mount(ctx) {
    const { root, win, opts, api } = ctx;
    const { h, icon, clear, render, store, bus, vfs, fmt } = api;

    const DIR = `${vfs.HOME}/Music`;
    const VDIR = `${vfs.HOME}/Videos`;
    const TRASH = `${vfs.HOME}/Trash`;
    const inTrash = p => p === TRASH || String(p).startsWith(`${TRASH}/`);
    const reduced = () => !!store.get('prefs.reduceMotion')
      || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    const h24 = () => store.get('prefs.h24') === true;

    /* The store is read fresh on every change: a take that was still saving
       when an earlier window closed may land at any moment. */
    let writing = false;
    const readData = () => normData(store.get(STORE_KEY));
    function writeData(fn) {
      const next = fn(readData());
      writing = true;
      try {
        store.set(STORE_KEY, { v: 1, items: next.items.map(x => ({ ...x })), deviceId: next.deviceId, voice: next.voice, source: next.source, narrate: next.narrate });
      } finally { writing = false; }
    }

    const first = readData();
    const S = {
      phase: 'idle',            /* idle | asking | recording | paused | saving | error */
      problem: null,            /* the error card, when phase is 'error' */
      notice: null,             /* { tone, text, actions } under the deck */
      view: 'rec',              /* 'rec' (the recorder) | 'item' (a recording) */
      sel: null,                /* id of the recording shown */
      pane: 'main',             /* narrow layouts: 'list' | 'main' */
      narrow: false,
      perm: '', permStatus: null,
      devices: [], deviceId: first.deviceId, voice: first.voice,
      source: first.source, narrate: first.narrate,   /* 'voice' | 'screen'; mic over a screen recording */
      R: null,                  /* the take in progress */
      gen: 0, pendingAc: null,
      items: [],                /* the recordings on screen, newest first */
      renaming: false, renameErr: '',
      speed: 1, muted: false, silent: false, clipAt: 0,
      dead: false,
    };
    const P = { id: null, token: 0, err: null, dur: 0, playing: false };   /* playback */

    const offs = [];
    const timers = new Set();
    const urls = new Set();
    const reg = { urls, timers };
    const after = (ms, fn) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };

    const ibtn = (ic, label, fn, cls = '') => h(`button.ibtn.tip.tip--below${cls}`, { type: 'button', 'data-tip': label, 'aria-label': label, onclick: fn }, icon(ic));

    /* ============================ layout ============================ */
    /* ---- the list pane ---- */
    const newTime = h('small.rec-new__time');
    const newBtn = h('button.side__item.rec-new', { type: 'button', title: 'New recording (R starts and stops)', onclick: () => showRecorder() },
      icon('mic'), h('span', { text: 'New recording' }), newTime);
    const countEl = h('span.rec-side__count');
    const listEl = h('div.rec-list', { role: 'list', 'aria-label': 'Recordings' });
    const footEl = h('div.rec-side__foot');
    const side = h('aside.app__side.rec-side', { 'aria-label': 'Recordings' },
      h('div.side__group.rec-side__top', newBtn),
      h('div.rec-side__lbl', h('span.side__label', { text: 'Recordings' }), countEl),
      h('div.rec-side__scroll', listEl),
      footEl);

    /* ---- the recorder ---- */
    const listCount = h('small');
    const toListBtn = h('button.btn.btn--sm.rec-tolist', { type: 'button', 'aria-label': 'Show recordings', onclick: () => { S.pane = 'list'; paint(); } },
      icon('list'), h('span', { text: 'Recordings' }), listCount);
    const micPill = h('span.rec-micpill', { title: '' }, h('i'), h('span'));
    const recBar = h('div.app__bar.rec-bar', toListBtn, h('div.app__title', { text: 'New recording' }), h('span.grow'), micPill);

    const liveCv = h('canvas.rec-wave__cv', { 'aria-hidden': 'true' });
    /* Screen mode shows what is being shared instead of the waveform */
    const liveVid = h('video.rec-wave__vid', { muted: true, playsinline: true, autoplay: true, 'aria-hidden': 'true' });
    const livePh = h('div.rec-wave__ph', icon('monitor'), h('span', { text: 'What you share shows here while it records' }));
    const liveWave = h('div.rec-wave.rec-wave--live', liveCv, liveVid, livePh);
    const modeBtn = (id, ic, label) => h('button.rec-mode', { type: 'button', role: 'radio', dataset: { mode: id }, onclick: () => setSource(id) },
      icon(ic), h('span', { text: label }));
    const modes = h('div.rec-modes', { role: 'radiogroup', 'aria-label': 'What to record' },
      modeBtn('voice', 'mic', 'Voice'), modeBtn('screen', 'monitor', 'Screen'));
    const stateText = h('span');
    const stateEl = h('div.rec-state', h('i.rec-state__dot', { 'aria-hidden': 'true' }), stateText);
    const timeEl = h('div.rec-time', { role: 'timer', 'aria-label': 'Recorded time' }, '0:00.0');
    const factsEl = h('div.rec-facts');

    const meterFill = h('i.rec-meter__fill');
    const meterPeak = h('i.rec-meter__peak');
    const meterDb = h('span.rec-meter__db', { text: '—' });
    const clipEl = h('span.rec-meter__clip', { text: 'Clipping' });
    const meterEl = h('div.rec-meter', { role: 'meter', 'aria-label': 'Input level', 'aria-valuemin': String(METER_DB), 'aria-valuemax': '0', 'aria-valuenow': String(METER_DB), 'aria-valuetext': 'Microphone off' },
      h('span.rec-meter__lbl', { text: 'Input' }),
      h('span.rec-meter__track', meterFill, meterPeak,
        h('span.rec-meter__ticks', { 'aria-hidden': 'true' }, [-48, -36, -24, -12, -6].map(d => h('i', { style: { left: `${(1 - d / METER_DB) * 100}%` } })))),
      meterDb, clipEl);

    const micSel = h('select.select.rec-micsel', { 'aria-label': 'Microphone', onchange: e => setDevice(e.target.value) });
    const micField = h('label.rec-src__mic', icon('mic'), micSel);
    const voiceBtn = h('button.rec-voice', { type: 'button', 'aria-pressed': 'true', onclick: () => toggleVoice(),
      title: 'Echo cancellation, noise suppression and automatic gain. Best for speech; turn off to record music.' },
    h('i.rec-voice__sw', { 'aria-hidden': 'true' }), h('span', { text: 'Voice processing' }));
    const narrateBtn = h('button.rec-voice', { type: 'button', 'aria-pressed': 'false', onclick: () => toggleNarrate(),
      title: 'Also record your microphone over the screen recording, mixed with any sound you share.' },
    h('i.rec-voice__sw', { 'aria-hidden': 'true' }), h('span', { text: 'Narrate with microphone' }));
    const srcRow = h('div.rec-src', micField, voiceBtn, narrateBtn);

    const bigGlyph = h('i.rec-big__glyph', { 'aria-hidden': 'true' });
    const bigBtn = h('button.rec-big', { type: 'button', onclick: () => onBig() }, bigGlyph, h('i.rec-big__spin', { 'aria-hidden': 'true' }));
    const bigCap = h('span.rec-cap', { 'aria-hidden': 'true' });
    const discardBtn = h('button.rec-round.rec-round--discard', { type: 'button', 'aria-label': 'Discard this take', title: 'Discard this take', onclick: () => askDiscard() }, icon('trash'));
    const pauseGlyph = h('span.rec-round__glyph');
    const pauseBtn = h('button.rec-round', { type: 'button', onclick: () => togglePause() }, pauseGlyph);
    const pauseCap = h('span.rec-cap', { 'aria-hidden': 'true' });
    const deck = h('div.rec-deck',
      h('div.rec-deck__slot.rec-deck__slot--side', discardBtn, h('span.rec-cap', { 'aria-hidden': 'true', text: 'Discard' })),
      h('div.rec-deck__slot', bigBtn, bigCap),
      h('div.rec-deck__slot.rec-deck__slot--side', pauseBtn, pauseCap));
    const noteEl = h('div.rec-note');
    const stage = h('div.rec-stage', modes, liveWave,
      h('div.rec-readout', stateEl, timeEl, factsEl),
      meterEl, deck, srcRow, noteEl);
    const errEl = h('div.rec-err');
    const recView = h('section.rec-view.rec-view--rec', { 'aria-label': 'Recorder' },
      recBar, h('div.app__content.rec-scroll', stage, errEl));

    /* ---- one recording ---- */
    const backBtn = ibtn('chevron-left', 'Back to recordings', () => { S.pane = 'list'; paint(); focusRow(S.sel); }, '.rec-back');
    const titleSlot = h('div.rec-titleslot');
    const newRecBtn = ibtn('mic', 'New recording', () => showRecorder(), '.rec-newrec');
    const playElsewhere = ibtn('music', 'Play in Music', () => openElsewhere(current()));
    const acts = h('div.rec-acts',
      ibtn('download', 'Download', () => download(current())),
      playElsewhere,
      ibtn('folder-open', 'Show in Files', () => showInFiles(current())),
      ibtn('trash', 'Move to Trash', () => trash(current()), '.rec-acts__trash'));
    const itemBar = h('div.app__bar.rec-ibar', backBtn, titleSlot, h('span.grow'), acts, newRecBtn);

    const fileCv = h('canvas.rec-wave__cv', { 'aria-hidden': 'true' });
    const scrub = h('input.rec-scrub', { type: 'range', min: '0', max: '0', step: '0.05', value: '0', 'aria-label': 'Playback position' });
    const fileMsg = h('div.rec-filemsg');
    const fileWave = h('div.rec-wave.rec-wave--file', fileCv, scrub);
    const curEl = h('span', { text: '0:00' });
    const durEl = h('span', { text: '0:00' });
    const playGlyph = h('span.rec-play__glyph');
    const playBtn = h('button.rec-play', { type: 'button', onclick: () => togglePlay() }, playGlyph);
    const back5 = h('button.rec-skip', { type: 'button', 'aria-label': 'Back 5 seconds', title: 'Back 5 seconds (←)', onclick: () => skip(-5) },
      icon('rotate-ccw'), h('small', { text: '5' }));
    const fwd5 = h('button.rec-skip.rec-skip--fwd', { type: 'button', 'aria-label': 'Forward 5 seconds', title: 'Forward 5 seconds (→)', onclick: () => skip(5) },
      icon('rotate-ccw'), h('small', { text: '5' }));
    const speedBtn = h('button.rec-speed', { type: 'button', onclick: () => cycleSpeed() });
    const pdeck = h('div.rec-pdeck', h('span.rec-pdeck__side'), back5, playBtn, fwd5, h('span.rec-pdeck__side.rec-pdeck__side--r', speedBtn));
    const infoEl = h('dl.rec-info');
    const player = h('div.rec-player', fileWave, fileMsg, h('div.rec-ptimes', curEl, durEl), pdeck);

    /* ---- the video editor (a video recording is selected) ---- */
    const vid = h('video.rec-ed__video', { playsinline: true, preload: 'auto' });
    const capCv = h('canvas.rec-ed__cap', { 'aria-hidden': 'true' });
    const edScreen = h('div.rec-ed__screen', vid, capCv);
    const edMsg = h('div.rec-filemsg.rec-ed__msg');
    const edGlyph = h('span.rec-play__glyph');
    const edPlay = h('button.rec-play.rec-ed__play', { type: 'button', onclick: () => togglePreview() }, edGlyph);
    const edNow = h('span.rec-ed__now', { text: '0:00.0' });
    const edCut = h('span.rec-ed__cutlen');
    const strip = h('canvas.rec-ed__strip', { 'aria-hidden': 'true' });
    const shadeL = h('i.rec-ed__shade.rec-ed__shade--l', { 'aria-hidden': 'true' });
    const shadeR = h('i.rec-ed__shade.rec-ed__shade--r', { 'aria-hidden': 'true' });
    const selBox = h('i.rec-ed__sel', { 'aria-hidden': 'true' });
    const capBand = h('i.rec-ed__band', { 'aria-hidden': 'true' });
    const head = h('button.rec-ed__head', { type: 'button', role: 'slider', 'aria-label': 'Playhead', dataset: { drag: 'head' } }, h('i'));
    const hIn = h('button.rec-ed__h.rec-ed__h--in', { type: 'button', role: 'slider', 'aria-label': 'Trim start', dataset: { drag: 'in' } }, h('i'));
    const hOut = h('button.rec-ed__h.rec-ed__h--out', { type: 'button', role: 'slider', 'aria-label': 'Trim end', dataset: { drag: 'out' } }, h('i'));
    const track = h('div.rec-ed__track', { role: 'group', 'aria-label': 'Timeline: drag the ends to trim, anywhere else to move the playhead', dataset: { drag: 'head' } },
      strip, shadeL, shadeR, selBox, capBand, head, hIn, hOut);
    /* a time field: type m:ss.s (or seconds), or take the playhead's time */
    function timeField(label, onSet, cls = '') {
      const input = h('input.rec-ed__tin', { type: 'text', inputmode: 'decimal', spellcheck: 'false', 'aria-label': label, autocomplete: 'off' });
      const commit = () => {
        const v = VC.parseClock(input.value);
        if (!Number.isFinite(v)) { input.setAttribute('aria-invalid', 'true'); return; }
        input.removeAttribute('aria-invalid');
        onSet(v);
      };
      input.addEventListener('change', commit);
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); input.removeAttribute('aria-invalid'); paintEditor(); input.blur(); }
      });
      const take = h('button.ibtn.rec-ed__take', { type: 'button', 'aria-label': `${label}: use the playhead’s time`, title: 'Use the playhead’s time',
        onclick: () => onSet(vid.currentTime || 0) }, icon('pin'));
      return { el: h(`label.rec-ed__tf${cls}`, h('span', { text: label }), input, take), input };
    }
    const inF = timeField('Start', v => setIn(v));
    const outF = timeField('End', v => setOut(v));
    const capText = h('input.rec-ed__captext', { type: 'text', maxlength: String(VC.CAPTION_MAX), placeholder: 'Type a caption (optional)', 'aria-label': 'Caption text', spellcheck: 'true' });
    const posBtns = VC.CAPTION_POS.map(pos => h('button.rec-ed__pos', { type: 'button', role: 'radio', dataset: { pos }, onclick: () => setCap({ pos }) },
      h('span', { text: pos[0].toUpperCase() + pos.slice(1) })));
    const capFromF = timeField('From', v => setCap({ from: v, touched: true }));
    const capToF = timeField('To', v => setCap({ to: v, touched: true }));
    const exportBtn = h('button.btn.btn--primary.rec-ed__export', { type: 'button', onclick: () => exportEdit() }, icon('film'), h('span', { text: 'Export to Videos' }));
    const resetBtn = h('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => resetEdit() }, icon('rotate-ccw'), h('span', { text: 'Reset' }));
    const cancelBtn = h('button.btn.btn--sm', { type: 'button', hidden: true, onclick: () => E.exp?.ctl.abort() }, icon('x'), h('span', { text: 'Cancel' }));
    const progFill = h('i');
    const progEl = h('div.rec-ed__prog', { role: 'progressbar', 'aria-label': 'Export progress', 'aria-valuemin': '0', 'aria-valuemax': '100', hidden: true }, progFill);
    const edNote = h('div.rec-note.rec-ed__note');
    const editor = h('div.rec-ed', { role: 'group', 'aria-label': 'Video editor' },
      edScreen, edMsg,
      h('div.rec-ed__transport', edPlay, h('div.rec-ed__times', edNow, edCut)),
      h('div.rec-ed__tl', track,
        h('div.rec-ed__trim', inF.el, outF.el, h('span.grow'), resetBtn)),
      h('section.rec-ed__panel', { 'aria-label': 'Caption' },
        h('div.rec-ed__ph', icon('type'), h('b', { text: 'Caption' }), h('small', { text: 'Burnt into the picture while it shows' })),
        capText,
        h('div.rec-ed__caprow',
          h('div.rec-ed__seg', { role: 'radiogroup', 'aria-label': 'Caption position' }, posBtns),
          capFromF.el, capToF.el)),
      h('div.rec-ed__out', exportBtn, cancelBtn, progEl,
        h('small.rec-ed__fine', { text: 'Export re-encodes the cut in this browser as it plays through once, in real time, and saves a new file next to this one. This recording is not changed.' })),
      edNote);

    /* voice effects (recorder-fx.js): a card under a voice recording; saving makes a new file */
    const fx = createFxPanel({
      h, icon,
      blobOf: it => media.blobOf(it.path),
      onPreview: () => pausePlayback(),
      save: saveEffect,
    });
    const itemView = h('section.rec-view.rec-view--item', { 'aria-label': 'Recording' },
      itemBar, h('div.app__content.rec-scroll', player, fx.el, editor, infoEl));

    const main = h('div.app__main.rec-main', recView, itemView);
    const live = h('div.sr', { 'aria-live': 'polite' });
    const appEl = h('div.app.vrec', side, main, live);
    root.appendChild(appEl);

    const say = text => { live.textContent = ''; after(40, () => { live.textContent = text; }); };

    const folderBtn = h('button.ibtn.tip.tip--below', { type: 'button', 'data-tip': 'Music folder', 'aria-label': 'Show the Music folder in Files',
      onclick: () => api.openApp('files', { path: DIR }) }, icon('folder-open'));
    win.setTools(folderBtn);

    /* ============================ colours for the canvases ============================ */
    let C = null;
    function readColors() {
      const cs = getComputedStyle(appEl);
      const v = (name, fb) => (cs.getPropertyValue(name) || '').trim() || fb;
      C = {
        accent: v('--accent', '#ff456d'), dim: v('--ink-4', '#544b50'), line: v('--line-2', 'rgba(255,255,255,.12)'),
        head: v('--ink-0', '#f6eef1'), ink3: v('--ink-3', '#7d7379'), red: v('--rec-red', '#e5484d'),
        font: v('--font', 'system-ui, sans-serif'),
      };
    }

    /* ============================ the list ============================ */
    const current = () => S.items.find(x => x.id === S.sel) || null;

    /** Find every tracked recording in the file system by its media id. */
    function reconcile() {
      const data = readData();
      const index = new Map();
      vfs.walk('/', (n, path) => {
        if (n.type === 'file' && typeof n.content === 'string' && n.content.startsWith(media.MEDIA)) index.set(n.content, { node: n, path });
      });
      let changed = false;
      const keep = [], shown = [];
      for (const it of data.items) {
        const hit = index.get(media.MEDIA + it.id);
        if (!hit) { changed = true; continue; }          /* deleted for good */
        const path = vfs.norm(hit.path);
        let rec = it;
        if (path !== it.path) { rec = { ...it, path }; changed = true; }
        keep.push(rec);
        if (!inTrash(path)) shown.push({ ...rec, node: hit.node, name: hit.node.name, size: hit.node.size || rec.size, at: rec.at || hit.node.mtime || '' });
      }
      if (changed) writeData(d => ({ ...d, items: keep }));
      shown.sort((a, b) => String(b.at).localeCompare(String(a.at)));
      S.items = shown;
      if (S.sel && !shown.some(x => x.id === S.sel)) {
        if (P.id === S.sel) unloadAudio();
        if (E.id === S.sel) { E.exp?.ctl.abort(); unloadEditor(); }
        S.sel = null;
        S.renaming = false;
        if (S.view === 'item') S.view = 'rec';
      }
    }

    function addItem(item) {
      writeData(d => ({ ...d, items: [...d.items.filter(x => x.id !== item.id), item] }));
    }
    function patchItem(id, patch) {
      writeData(d => ({ ...d, items: d.items.map(x => (x.id === id ? { ...x, ...patch } : x)) }));
    }

    const rows = new Map();     /* id -> { el, main, name, meta, ic, key } */
    let emptyEl = null;

    function rowFor(it) {
      let r = rows.get(it.id);
      if (!r) {
        const name = h('b.rec-row__name');
        const meta = h('small.rec-row__meta');
        const ic = h('span.rec-row__ic', { 'aria-hidden': 'true' });
        const mainBtn = h('button.rec-row__main', { type: 'button' }, ic, h('span.rec-row__txt', name, meta));
        const more = h('button.ibtn.rec-row__more', { type: 'button' }, icon('more-horizontal'));
        const el = h('div.rec-row', { role: 'listitem', dataset: { id: it.id } }, mainBtn, more);
        r = { el, main: mainBtn, name, meta, ic, more, key: '' };
        mainBtn.addEventListener('click', () => select(r.id));
        mainBtn.addEventListener('contextmenu', e => { e.preventDefault(); rowMenu(e, r.id, mainBtn); });
        mainBtn.addEventListener('keydown', e => rowKey(e, r.id));
        more.addEventListener('click', e => rowMenu(e, r.id, more));
        rows.set(it.id, r);
      }
      r.id = it.id;
      const on = S.sel === it.id && S.view === 'item';
      const playing = P.id === it.id && P.playing;
      const stem = stemOf(it.name);
      const metaText = `${it.ms ? clock(it.ms) : '—'} · ${whenText(it.at, h24())}`;
      const key = `${stem}|${metaText}|${on}|${playing}|${it.kind}`;
      if (key !== r.key) {
        r.key = key;
        r.name.textContent = stem;
        r.meta.textContent = metaText;
        r.el.classList.toggle('is-on', on);
        r.main.setAttribute('aria-current', on ? 'true' : 'false');
        r.main.setAttribute('aria-label', `${stem}, ${it.kind === 'video' ? 'video, ' : ''}${it.ms ? lengthText(it.ms) : 'length unknown'}, ${whenText(it.at, h24())}${playing ? ', playing' : ''}`);
        r.more.setAttribute('aria-label', `More for ${stem}`);
        r.more.title = 'More';
        clear(r.ic);
        r.ic.append(playing ? h('span.rec-eq', h('i'), h('i'), h('i')) : icon(it.kind === 'video' ? 'video' : 'mic'));
      }
      return r.el;
    }

    function paintList() {
      countEl.textContent = S.items.length ? String(S.items.length) : '';
      listCount.textContent = S.items.length ? String(S.items.length) : '';
      const alive = new Set(S.items.map(x => x.id));
      for (const id of [...rows.keys()]) if (!alive.has(id)) { rows.get(id).el.remove(); rows.delete(id); }
      let kids;
      if (!S.items.length) {
        emptyEl = emptyEl || h('div.rec-empty', icon('mic'),
          h('b', { text: 'No recordings yet' }),
          h('small', { text: 'Press Record. Voice takes are saved to Music, screen recordings to Videos, on this device.' }));
        kids = [emptyEl];
      } else kids = S.items.map(rowFor);
      /* move nothing already in place, so a focused row keeps its focus */
      kids.forEach((k, i) => { if (listEl.children[i] !== k) listEl.insertBefore(k, listEl.children[i] || null); });
      while (listEl.children.length > kids.length) listEl.lastElementChild.remove();

      const total = S.items.reduce((n, x) => n + (x.size || 0), 0);
      const places = [S.items.some(x => x.kind !== 'video') ? 'Music' : '', S.items.some(x => x.kind === 'video') ? 'Videos' : ''].filter(Boolean).join(' and ');
      clear(footEl);
      footEl.append(h('div.side__meter',
        h('b', { text: S.items.length ? `${S.items.length} recording${S.items.length === 1 ? '' : 's'}` : 'No recordings' }),
        h('small', { text: S.items.length ? `${bytes(total)} in ${places}` : 'Saved to Music and Videos' })),
      h('div.rec-side__note', { text: db.persistent === false ? 'This browser isn’t keeping files between visits.' : 'Kept in this browser, on this device.' }));
    }

    function focusRow(id) {
      requestAnimationFrame(() => {
        if (S.dead) return;
        const r = id && rows.get(id);
        (r ? r.main : newBtn).focus({ preventScroll: false });
      });
    }

    function rowKey(e, id) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const i = S.items.findIndex(x => x.id === id);
        const next = S.items[i + (e.key === 'ArrowDown' ? 1 : -1)];
        if (next) rows.get(next.id)?.main.focus();
        else if (e.key === 'ArrowUp') newBtn.focus();
      } else if (e.key === 'Delete' || (e.key === 'Backspace' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        const it = S.items.find(x => x.id === id);
        if (it) trash(it, { focusNext: true });
      } else if (e.key === 'F2') {
        e.preventDefault();
        select(id);
        startRename();
      }
    }

    function rowMenu(e, id, anchor) {
      const it = S.items.find(x => x.id === id);
      if (!it) return;
      const r = anchor.getBoundingClientRect();
      const x = e.clientX || r.left + r.width / 2, y = e.clientY || r.bottom;
      const playing = P.id === id && P.playing;
      const isVid = it.kind === 'video';
      api.menu([
        isVid ? { label: 'Trim and caption…', icon: 'film', onClick: () => select(id) }
          : { label: playing ? 'Pause' : 'Play', icon: playing ? 'pause' : 'play', onClick: () => { select(id); togglePlay(); } },
        { label: 'Rename…', icon: 'edit-3', hint: 'F2', onClick: () => { select(id); startRename(); } },
        { label: 'Download', icon: 'download', onClick: () => download(it) },
        '-',
        { label: isVid ? 'Play in Videos' : 'Play in Music', icon: isVid ? 'play' : 'music', onClick: () => openElsewhere(it) },
        { label: 'Show in Files', icon: 'folder-open', onClick: () => showInFiles(it) },
        '-',
        { label: 'Move to Trash', icon: 'trash', hint: 'Del', danger: true, onClick: () => trash(it) },
      ], x, y);
    }

    /* ============================ views ============================ */
    /** Move focus to el, but only if focus is ours to move (inside this window, or nowhere). */
    function refocus(el) {
      requestAnimationFrame(() => {
        if (S.dead || !el.isConnected || !win.el.classList.contains('is-active')) return;
        const a = document.activeElement;
        if (!a || a === document.body || appEl.contains(a)) el.focus({ preventScroll: true });
      });
    }

    function select(id, { focusPlay = false } = {}) {
      const it = S.items.find(x => x.id === id);
      if (!it) return;
      if (E.exp && id !== E.id) {
        S.sel = E.id;
        S.view = 'item';
        paint();
        say('An export is running. Wait for it to finish, or cancel it, before opening another recording.');
        return;
      }
      if (S.sel !== id) { S.renaming = false; S.renameErr = ''; }
      if (it.kind === 'video') { if (P.id) unloadAudio(); loadEditor(it); }
      else { if (E.id) unloadEditor(); if (P.id !== id) loadAudio(it); }
      S.sel = id;
      S.view = 'item';
      if (S.narrow) S.pane = 'main';
      paint();
      if (focusPlay) refocus(it.kind === 'video' ? edPlay : playBtn);
    }
    function showRecorder() {
      pausePreview();
      fx.hide();
      S.view = 'rec';
      S.renaming = false;
      if (S.narrow) S.pane = 'main';
      paint();
    }

    function paintPanes() {
      const showItem = S.view === 'item' && !!current();
      if (!showItem && S.view === 'item') S.view = 'rec';
      recView.hidden = showItem;
      itemView.hidden = !showItem;
      appEl.classList.toggle('is-narrow', S.narrow);
      appEl.classList.toggle('show-list', S.narrow && S.pane === 'list');
      newBtn.classList.toggle('is-on', !showItem);
      newBtn.setAttribute('aria-current', showItem ? 'false' : 'true');
    }

    /* ============================ the recorder view ============================ */
    const activeMs = R => (R ? R.activeMs + (R.segStart ? performance.now() - R.segStart : 0) : 0);
    const canPause = () => !!S.R && typeof S.R.rec.pause === 'function' && typeof S.R.rec.resume === 'function';

    let errShown = null, noteShown = null;
    function paintRec() {
      const R = S.R, ph = S.phase;
      const err = ph === 'error' && S.problem ? S.problem : null;
      stage.hidden = !!err;
      errEl.hidden = !err;
      if (err !== errShown) {
        errShown = err;
        clear(errEl);
        if (err) {
          errEl.append(h('div.rec-err__card', { role: 'alert' },
            h('div.rec-err__ic', icon(err.icon || 'alert')),
            h('b', { text: err.title }),
            h('p', { text: err.body }),
            err.retry === false ? null : h('div.rec-err__acts',
              h('button.btn.btn--primary', { type: 'button', onclick: () => startRecording() }, icon(screenMode() ? 'monitor' : 'mic'), h('span', { text: err.action || 'Try again' })))));
        }
      }
      const scr = screenMode();
      stage.dataset.phase = ph;
      stage.dataset.source = scr ? 'screen' : 'voice';
      const live = ph === 'recording' || ph === 'paused';
      stateText.textContent = (scr ? {
        idle: 'Ready to record your screen', asking: 'Waiting for you to choose what to share…', recording: 'Recording your screen',
        paused: 'Paused — still sharing', saving: 'Saving…', error: '',
      } : {
        idle: 'Ready to record', asking: 'Waiting for the microphone…', recording: 'Recording',
        paused: 'Paused — the microphone is still on', saving: 'Saving…', error: '',
      })[ph] || '';
      factsEl.textContent = factsLine();
      for (const b of modes.children) {
        const on = b.dataset.mode === (scr ? 'screen' : 'voice');
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
        b.disabled = !!R || ph === 'asking' || ph === 'saving';
      }
      liveWave.classList.toggle('rec-wave--screen', scr);
      if (scr && R && R.preview && liveVid.srcObject !== R.preview) { liveVid.srcObject = R.preview; liveVid.play?.()?.catch?.(() => {}); }
      if ((!scr || !R) && liveVid.srcObject) liveVid.srcObject = null;
      liveVid.hidden = !(scr && R);
      livePh.hidden = !scr || !!R;
      liveCv.hidden = scr;
      /* a screen take may carry no sound at all: then there is no level to show */
      meterEl.hidden = scr && !(R && R.hasAudio);

      /* the big button */
      const blocked = !!precheck(scr ? 'screen' : 'voice');
      bigBtn.disabled = ph === 'saving' || (blocked && !R);
      const bigLabel = ph === 'asking' ? (scr ? 'Cancel — waiting for you to choose what to share' : 'Cancel — waiting for the microphone')
        : live ? 'Stop and save (R)'
          : ph === 'saving' ? 'Saving the recording' : scr ? 'Start recording the screen (R)' : 'Start recording (R)';
      bigBtn.setAttribute('aria-label', bigLabel);
      bigBtn.title = bigLabel;
      bigCap.textContent = ph === 'asking' ? 'Cancel' : live ? 'Stop' : ph === 'saving' ? 'Saving…' : 'Record';

      /* discard + pause */
      deck.classList.toggle('is-live', live);
      discardBtn.disabled = !live;
      discardBtn.tabIndex = live ? 0 : -1;
      const pausable = canPause();
      pauseBtn.disabled = !live || !pausable;
      pauseBtn.tabIndex = live ? 0 : -1;
      const pLabel = !pausable && live ? 'This browser can’t pause a recording'
        : ph === 'paused' ? 'Resume recording (P)' : 'Pause recording (P)';
      pauseBtn.setAttribute('aria-label', pLabel);
      pauseBtn.title = pLabel;
      pauseCap.textContent = ph === 'paused' ? 'Resume' : 'Pause';
      clear(pauseGlyph);
      pauseGlyph.append(ph === 'paused' ? h('i.rec-dot') : icon('pause'));

      /* whether this window holds the microphone (or the screen) right now */
      const micOn = !!R;
      micPill.classList.toggle('is-on', micOn);
      micPill.lastChild.textContent = scr ? (micOn ? (R.mic ? 'Sharing · mic on' : 'Sharing') : 'Not sharing') : micOn ? 'Mic on' : 'Mic off';
      micPill.title = scr ? (micOn ? 'This window is recording what you shared' : 'Nothing is shared — the browser asks when you press Record')
        : micOn ? 'This window is using the microphone' : 'The microphone is off — it only turns on while recording';

      paintSource();
      paintNotice();
      paintMeter(true);
      paintClock(true);
      drawLive();
    }

    function factsLine() {
      const R = S.R;
      if (R && R.kind === 'video') {
        const st = R.settings || {};
        const bits = [];
        if (st.width && st.height) bits.push(`${st.width}×${st.height}`);
        if (st.frameRate) bits.push(`${Math.round(st.frameRate)} fps`);
        bits.push(R.hasAudio ? (R.mic && R.shared ? 'shared sound + microphone' : R.mic ? 'microphone' : 'shared sound') : 'no sound');
        bits.push(describeVideo(R.type, /mp4/.test(R.type) ? 'mp4' : 'webm'));
        bits.push(R.bytes ? `${bytes(R.bytes)} so far` : 'starting…');
        return bits.join(' · ');
      }
      if (S.phase === 'saving' && screenMode()) return 'Writing the video to Videos';
      if (!R && screenMode()) {
        const t = VC.videoRecorderType();
        if (t === null) return '';
        return `${t ? describeVideo(t, /mp4/.test(t) ? 'mp4' : 'webm') : 'Video'} · saved to Videos · the browser asks what to share${S.narrate ? ' · with your microphone' : ''}`;
      }
      if (R) {
        const st = R.settings || {};
        const bits = [shortLabel(R.label) || 'Microphone'];
        if (st.sampleRate) bits.push(`${Math.round(st.sampleRate / 100) / 10} kHz ${st.channelCount === 2 ? 'stereo' : st.channelCount > 2 ? `${st.channelCount} ch` : 'mono'}`);
        const fb = /mp4/.test(R.type) ? 'm4a' : /ogg/.test(R.type) ? 'ogg' : 'weba';
        bits.push(describe(R.type, fb));
        bits.push(R.bytes ? `${bytes(R.bytes)} so far` : 'starting…');
        return bits.join(' · ');
      }
      if (S.phase === 'saving') return 'Measuring the take and writing it to Music';
      const t = recorderType();
      if (t === null) return '';
      const fb = /mp4/.test(t) ? 'm4a' : /ogg/.test(t) ? 'ogg' : 'weba';
      const perm = S.perm === 'granted' ? 'Microphone allowed' : 'The browser will ask to use the microphone';
      return `${t ? describe(t, fb) : 'Audio'} · saved to Music · ${perm}`;
    }

    let micKey = '';
    function paintSource() {
      const busy = !!S.R || S.phase === 'asking' || S.phase === 'saving';
      const labelled = S.devices.filter(d => d.label && d.deviceId !== 'communications');
      micField.hidden = labelled.length < 2;
      if (!micField.hidden) {
        const key = JSON.stringify([S.deviceId, labelled.map(d => [d.deviceId, d.label])]);
        if (key !== micKey) {
          micKey = key;
          clear(micSel);
          const hasDefault = labelled.some(d => d.deviceId === 'default');
          if (!hasDefault) micSel.append(h('option', { value: '', text: 'System default microphone' }));
          labelled.forEach((d, i) => micSel.append(h('option', {
            value: d.deviceId === 'default' ? '' : d.deviceId, text: shortLabel(d.label) || `Microphone ${i + 1}`,
          })));
          micSel.value = S.deviceId && labelled.some(d => d.deviceId === S.deviceId) ? S.deviceId : '';
        }
        micSel.disabled = busy;
      }
      voiceBtn.setAttribute('aria-pressed', String(S.voice));
      voiceBtn.classList.toggle('is-on', S.voice);
      voiceBtn.disabled = busy;
      narrateBtn.setAttribute('aria-pressed', String(S.narrate));
      narrateBtn.classList.toggle('is-on', S.narrate);
      narrateBtn.disabled = busy;
      const scr = screenMode();
      if (scr) micField.hidden = true;
      voiceBtn.hidden = scr;
      narrateBtn.hidden = !scr;
      srcRow.hidden = !!S.problem && S.phase === 'error';
    }

    function paintNotice() {
      /* live conditions outrank a past notice */
      let n = S.notice;
      if (S.R && S.R.kind === 'video') { /* a shared window can go quiet on purpose: no mic warnings */ }
      else if (S.R && S.muted) n = { tone: 'warn', text: 'The microphone isn’t sending any sound right now — it may be muted by the system, a hardware switch or another app.' };
      else if (S.R && S.silent) n = { tone: 'warn', text: 'Only digital silence is coming in. Check that the microphone isn’t muted.' };
      const key = n ? `${n.tone}|${n.text}` : '';
      if (key === noteShown) return;
      noteShown = key;
      clear(noteEl);
      noteEl.hidden = !n;
      if (!n) return;
      noteEl.dataset.tone = n.tone;
      noteEl.append(icon(n.tone === 'err' || n.tone === 'warn' ? 'alert' : n.tone === 'ok' ? 'check-circle' : 'info'),
        h('span.rec-note__t', { text: n.text }),
        ...(n.actions || []).map(a => h('button.btn.btn--sm', { type: 'button', onclick: a.fn }, a.label)));
    }

    let lastClock = '';
    function paintClock(force) {
      const t = clock(activeMs(S.R), true);
      if (t !== lastClock || force) { lastClock = t; timeEl.textContent = t; }
    }

    let meterAria = 0;
    function paintMeter(force) {
      const R = S.R;
      const on = !!(R && R.an && R.ac && R.ac.state === 'running');
      meterEl.classList.toggle('is-off', !on);
      const now = performance.now();
      if (!on) {
        meterFill.style.clipPath = 'inset(0 100% 0 0)';
        meterPeak.style.opacity = '0';
        meterDb.textContent = R ? '…' : '—';
        clipEl.hidden = true;
        if (force || meterAria) { meterAria = 0; meterEl.setAttribute('aria-valuenow', String(METER_DB)); meterEl.setAttribute('aria-valuetext', R ? 'Waiting for sound' : 'Microphone off'); }
        return;
      }
      const lvl = Number.isFinite(R.disp) ? clamp((R.disp - METER_DB) / -METER_DB, 0, 1) : 0;
      meterFill.style.clipPath = `inset(0 ${((1 - lvl) * 100).toFixed(2)}% 0 0)`;
      const hold = Number.isFinite(R.hold) ? clamp((R.hold - METER_DB) / -METER_DB, 0, 1) : 0;
      meterPeak.style.opacity = hold > 0 ? '1' : '0';
      meterPeak.style.left = `${(hold * 100).toFixed(2)}%`;
      clipEl.hidden = !(S.clipAt && now - S.clipAt < 1500);
      if (force || now - meterAria > 250) {
        meterAria = now;
        const dbv = Number.isFinite(R.disp) && R.disp > METER_DB ? Math.round(R.disp) : null;
        meterDb.textContent = dbv === null ? `< ${minus(METER_DB)} dB` : `${minus(dbv)} dB`;
        meterEl.setAttribute('aria-valuenow', String(dbv === null ? METER_DB : dbv));
        meterEl.setAttribute('aria-valuetext', dbv === null ? 'Silence' : `${dbv} decibels`);
      }
    }

    /* ============================ canvases ============================ */
    const dprs = new WeakMap();
    function fit(cv) {
      const box = cv.parentElement;
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const w = Math.max(0, Math.round(box.clientWidth * dpr)), hh = Math.max(0, Math.round(box.clientHeight * dpr));
      if (cv.width !== w) cv.width = w;
      if (cv.height !== hh) cv.height = hh;
      dprs.set(cv, dpr);
    }

    /** The take so far: one bar per 50 ms recorded, newest at the red "now" line. */
    function drawLive() {
      const cv = liveCv, W = cv.width, H = cv.height;
      if (!W || !H || !C) return;
      const g = cv.getContext('2d');
      const dpr = dprs.get(cv) || 1;
      g.clearRect(0, 0, W, H);
      const ruler = H > 90 * dpr ? Math.round(16 * dpr) : 0;
      const mid = Math.round((H - ruler) / 2);
      const amp = (H - ruler) / 2 - 4 * dpr;
      const nowX = W - Math.round(22 * dpr);
      const R = S.R;
      g.fillStyle = C.line;
      g.fillRect(0, mid, W, Math.max(1, Math.round(dpr)));
      if (R) {
        const pitch = PITCH * dpr, bw = Math.max(1, Math.round(2 * dpr));
        const pos = activeMs(R) / BUCKET_MS;
        const idx = Math.floor(pos);
        const frac = reduced() ? 0 : pos - idx;
        const L = R.levels;
        g.fillStyle = C.accent;
        for (let k = 0; ; k++) {
          const x = nowX - (k + frac) * pitch - bw;
          if (x < -bw) break;
          let v;
          if (k === 0) v = R.cur;
          else { const j = L.length - k; if (j < 0) break; v = L[j]; }
          if (v === null || v === undefined) {
            if (k === 0) continue;
            g.fillStyle = C.dim;
            g.fillRect(Math.round(x), mid - Math.round(dpr), bw, Math.max(1, Math.round(2 * dpr)));
            g.fillStyle = C.accent;
            continue;
          }
          const hh = Math.max(dpr, v * amp);
          g.fillRect(Math.round(x), Math.round(mid - hh), bw, Math.max(1, Math.round(hh * 2)));
        }
        if (ruler) {
          /* a tick every second recorded, a label every five */
          g.fillStyle = C.ink3;
          g.font = `${Math.round(10 * dpr)}px ${C.font}`;
          g.textBaseline = 'bottom';
          const perSec = 1000 / BUCKET_MS;
          const firstSec = Math.max(0, Math.floor((idx - nowX / pitch) / perSec));
          for (let s = firstSec; s * perSec <= pos; s++) {
            const x = Math.round(nowX - (pos - s * perSec) * pitch);
            if (x < 0) continue;
            const major = s % 5 === 0;
            g.fillRect(x, H - Math.round((major ? 7 : 4) * dpr), Math.max(1, Math.round(dpr)), Math.round((major ? 7 : 4) * dpr));
            if (major) g.fillText(clock(s * 1000), x + Math.round(3 * dpr), H - Math.round(4 * dpr));
          }
        }
      }
      g.fillStyle = R ? C.red : C.dim;
      g.fillRect(nowX, Math.round(4 * dpr), Math.max(2, Math.round(2 * dpr)), H - ruler - Math.round(8 * dpr));
    }

    const peakCache = new Map();    /* id|n -> resampled values */
    function drawFile() {
      const cv = fileCv, W = cv.width, H = cv.height;
      const it = current();
      if (!W || !H || !C || !it) return;
      const g = cv.getContext('2d');
      const dpr = dprs.get(cv) || 1;
      g.clearRect(0, 0, W, H);
      const pitch = PITCH * dpr, bw = Math.max(1, Math.round(2 * dpr));
      const n = Math.max(1, Math.floor(W / pitch));
      const key = `${it.id}|${n}|${it.peaks.length}`;
      let vals = peakCache.get(key);
      if (!vals) {
        vals = resample(decodePeaks(it.peaks), n);
        peakCache.clear();
        peakCache.set(key, vals);
      }
      const mid = Math.round(H / 2), amp = H / 2 - 3 * dpr;
      const dur = P.id === it.id && P.dur ? P.dur : it.ms / 1000;
      const t = P.id === it.id ? audio.currentTime || 0 : 0;
      const px = dur ? clamp(t / dur, 0, 1) * W : 0;
      g.fillStyle = C.line;
      g.fillRect(0, mid, W, Math.max(1, Math.round(dpr)));
      if (it.peaks) {
        for (let i = 0; i < n; i++) {
          const x = Math.round(i * pitch);
          const hh = Math.max(dpr, vals[i] * amp);
          g.fillStyle = x + bw <= px ? C.accent : C.dim;
          g.fillRect(x, Math.round(mid - hh), bw, Math.max(1, Math.round(hh * 2)));
        }
      }
      g.fillStyle = C.head;
      g.fillRect(Math.min(W - Math.round(2 * dpr), Math.round(px)), 0, Math.max(2, Math.round(2 * dpr)), H);
    }

    /* ============================ the frame loop ============================ */
    let raf = 0, lastSlow = 0;
    const kick = () => { if (!raf && !S.dead) raf = requestAnimationFrame(frame); };
    function frame(now) {
      raf = 0;
      if (S.dead) return;
      const R = S.R;
      if (R) {
        sample(R, now);
        if (!recView.hidden) { drawLive(); paintClock(); paintMeter(); }
        if (now - lastSlow > 250) { lastSlow = now; paintSlow(); }
      }
      if (P.playing) paintPlayhead();
      if (E.playing) editorFrame();
      if (R || P.playing || E.playing) raf = requestAnimationFrame(frame);
    }
    /* the few things that change every second or so while recording */
    function paintSlow() {
      const R = S.R;
      newTime.textContent = R ? `${S.phase === 'paused' ? 'Paused' : '●'} ${clock(activeMs(R))}` : '';
      newBtn.classList.toggle('is-rec', !!R && S.phase === 'recording');
      win.setSubtitle(R ? `${S.phase === 'paused' ? 'Paused' : 'Recording'} ${clock(activeMs(R))}` : '');
      if (!recView.hidden) {
        factsEl.textContent = factsLine();
        if (R) paintNotice();
      }
    }

    /** Read the analyser: the meter's level and peak, and this bucket's bar. */
    function sample(R, now) {
      const dt = Math.min(250, Math.max(0, now - (R.lastNow || now)));
      R.lastNow = now;
      if (!R.an || !R.ac) return;
      if (R.ac.state !== 'running') { R.ac.resume?.()?.catch?.(() => {}); return; }
      R.an.getFloatTimeDomainData(R.buf);
      let peak = 0, sum = 0;
      for (let i = 0; i < R.buf.length; i++) {
        const v = R.buf[i];
        const a = v < 0 ? -v : v;
        if (a > peak) peak = a;
        sum += v * v;
      }
      const rms = dbOf(Math.sqrt(sum / R.buf.length));
      /* meter ballistics: instant rise, a 24 dB/s fall, a 1.5 s peak hold */
      R.disp = Math.max(rms, (Number.isFinite(R.disp) ? R.disp : -120) - dt * 0.024);
      const pk = dbOf(peak);
      if (!Number.isFinite(R.hold) || pk >= R.hold || now - R.holdAt > 1500) { R.hold = pk; R.holdAt = now; }
      if (peak >= 0.985) S.clipAt = now;
      if (S.phase === 'recording') {
        const idx = Math.floor(activeMs(R) / BUCKET_MS);
        /* close finished buckets; one with no reading (tab hidden) stays empty */
        while (R.levels.length < idx) { R.levels.push(R.cur); R.cur = null; }
        R.cur = Math.max(R.cur ?? 0, levelOf(peak));
        R.zeroMs = peak === 0 ? R.zeroMs + dt : 0;
        const silent = R.zeroMs > 3000;
        if (silent !== S.silent) { S.silent = silent; paintNotice(); }
      }
    }

    /* ============================ recording ============================ */
    function closeAc(ac) { try { ac?.close?.()?.catch?.(() => {}); } catch (err) { /* already closed */ } }

    async function permState() {
      try { return (await navigator.permissions.query({ name: 'microphone' })).state; } catch (err) { return ''; }
    }

    async function watchPermission() {
      if (S.permStatus || !navigator.permissions?.query) return;
      let st;
      try { st = await navigator.permissions.query({ name: 'microphone' }); } catch (err) { return; }
      if (S.dead || S.permStatus) return;
      S.permStatus = st;
      S.perm = st.state;
      st.onchange = () => {
        S.perm = st.state;
        if (S.dead) return;
        if (st.state === 'granted' && S.phase === 'error' && ['denied', 'dismissed', 'os'].includes(S.problem?.kind)) {
          S.phase = 'idle';
          S.problem = null;
          S.notice = { tone: 'ok', text: 'Microphone allowed. Press Record when you’re ready.' };
          refreshDevices();
        } else if (st.state === 'denied' && S.phase === 'idle') {
          S.phase = 'error';
          S.problem = micProblem(new DOMException('Permission denied', 'NotAllowedError'));
        }
        paint();
      };
      /* blocked before anyone pressed anything: say so now, not after a click */
      if (st.state === 'denied' && S.phase === 'idle') {
        S.phase = 'error';
        S.problem = micProblem(new DOMException('Permission denied', 'NotAllowedError'));
      }
      paint();
    }

    async function refreshDevices() {
      try {
        const list = await navigator.mediaDevices.enumerateDevices();
        if (S.dead) return;
        S.devices = list.filter(d => d.kind === 'audioinput' && d.deviceId);
        paintSource();
      } catch (err) { /* the picker just stays hidden */ }
    }

    function setDevice(id) {
      if (S.R) return;
      S.deviceId = id || '';
      writeData(d => ({ ...d, deviceId: S.deviceId }));
      paintSource();
    }
    function toggleVoice() {
      if (S.R || S.phase === 'asking') return;
      S.voice = !S.voice;
      writeData(d => ({ ...d, voice: S.voice }));
      paintSource();
      say(`Voice processing ${S.voice ? 'on' : 'off'}`);
    }
    function toggleNarrate() {
      if (S.R || S.phase === 'asking') return;
      S.narrate = !S.narrate;
      writeData(d => ({ ...d, narrate: S.narrate }));
      paintSource();
      factsEl.textContent = factsLine();
      say(`Microphone narration ${S.narrate ? 'on' : 'off'}`);
    }
    /** what the deck records: the take in progress decides, else the switch */
    const screenMode = () => (S.R ? S.R.kind === 'video' : S.source === 'screen');
    function setSource(mode) {
      if (S.R || S.phase === 'asking' || S.phase === 'saving' || (mode !== 'voice' && mode !== 'screen')) return;
      if (mode === S.source && S.phase !== 'error') return;
      S.source = mode;
      writeData(d => ({ ...d, source: mode }));
      /* a problem belongs to the source it came from */
      const pre = precheck(mode);
      if (pre) { S.phase = 'error'; S.problem = pre; }
      else if (S.phase === 'error') { S.phase = 'idle'; S.problem = null; }
      S.notice = null;
      paint();
      say(mode === 'screen' ? 'Screen recording' : 'Voice recording');
    }

    function onBig() {
      if (S.phase === 'asking') { cancelAsk(); return; }
      if (S.R) { finish('user'); return; }
      if (S.phase === 'saving') return;
      startRecording();
    }

    function cancelAsk() {
      S.gen++;
      closeAc(S.pendingAc);
      S.pendingAc = null;
      S.phase = 'idle';
      paint();
      say('Cancelled');
    }

    /* the card is role=alert, so it announces itself */
    function fail(problem) {
      S.phase = 'error';
      S.problem = problem;
      paint();
    }

    async function startRecording() {
      if (S.dead || S.R || S.phase === 'asking' || S.phase === 'saving') return;
      if (S.source === 'screen') { startScreen(); return; }
      const pre = precheck();
      if (pre) { fail(pre); return; }
      pausePlayback();
      /* made inside the click, so the browser lets it run */
      const AC = window.AudioContext || window.webkitAudioContext;
      let ac = null;
      try { ac = AC ? new AC() : null; } catch (err) { ac = null; }
      S.pendingAc = ac;
      const gen = ++S.gen;
      S.phase = 'asking';
      S.problem = null;
      S.notice = null;
      paint();
      const md = navigator.mediaDevices;
      const want = id => ({
        audio: { ...(id ? { deviceId: { exact: id } } : {}), echoCancellation: S.voice, noiseSuppression: S.voice, autoGainControl: S.voice },
        video: false,
      });
      let stream = null, err = null;
      try { stream = await md.getUserMedia(want(S.deviceId)); } catch (e) { err = e; }
      /* the remembered microphone is gone: use the default one */
      if (!stream && S.deviceId && gen === S.gen && !S.dead && (err?.name === 'OverconstrainedError' || err?.name === 'NotFoundError')) {
        try { stream = await md.getUserMedia(want('')); err = null; setDevice(''); } catch (e) { err = e; }
      }
      if (gen !== S.gen || S.dead) {
        stream?.getTracks().forEach(t => t.stop());
        closeAc(ac);
        if (S.pendingAc === ac) S.pendingAc = null;
        return;
      }
      S.pendingAc = null;
      if (!stream) {
        closeAc(ac);
        let problem = micProblem(err);
        /* the permission store is the authority: some browsers report a block as another error */
        if (problem.kind !== 'denied' && problem.kind !== 'os' && (await permState()) === 'denied') {
          problem = micProblem(new DOMException('Permission denied', 'NotAllowedError'));
        }
        if (gen !== S.gen || S.dead) return;
        fail(problem);
        watchPermission();
        return;
      }
      const track = stream.getAudioTracks()[0];
      if (!track) {
        stream.getTracks().forEach(t => t.stop());
        closeAc(ac);
        fail(micProblem(new DOMException('No audio track', 'NotFoundError')));
        return;
      }
      const type = recorderType();
      let rec = null, recErr = null;
      for (const o of [type ? { mimeType: type, audioBitsPerSecond: BITRATE } : { audioBitsPerSecond: BITRATE }, type ? { mimeType: type } : null, {}]) {
        if (!o) continue;
        try { rec = new MediaRecorder(stream, o); break; } catch (e) { recErr = e; rec = null; }
      }
      const giveUp = e => {
        stream.getTracks().forEach(t => t.stop());
        closeAc(ac);
        fail({ kind: 'failed', icon: 'alert', title: 'Recording couldn’t start',
          body: `The browser’s recorder refused to start: “${e?.message || 'no details'}” (${e?.name || 'Error'}). Press Try again; if it keeps happening, reload StaticOS.` });
      };
      if (!rec) { giveUp(recErr); return; }
      const now = performance.now();
      const R = {
        rec, stream, track, ac, src: null, an: null, buf: null,
        chunks: [], bytes: 0, type: rec.mimeType || type || '', when: new Date(),
        activeMs: 0, segStart: now, levels: [], cur: null,
        settings: (track.getSettings && track.getSettings()) || {}, label: track.label || '',
        error: null, disp: -Infinity, hold: -Infinity, holdAt: 0, zeroMs: 0, lastNow: now,
      };
      R.stopped = new Promise(res => rec.addEventListener('stop', res, { once: true }));
      R.onData = e => { if (e.data && e.data.size) { R.chunks.push(e.data); R.bytes += e.data.size; } };
      R.onError = e => { R.error = e?.error || e; if (S.R === R) finish('error'); };
      R.onEnded = () => { if (S.R === R) finish('ended'); };
      R.onMute = () => { S.muted = !!track.muted; if (!S.dead) paintNotice(); };
      rec.addEventListener('dataavailable', R.onData);
      rec.addEventListener('error', R.onError);
      track.addEventListener('ended', R.onEnded);
      track.addEventListener('mute', R.onMute);
      track.addEventListener('unmute', R.onMute);
      try { rec.start(1000); } catch (e) {
        track.removeEventListener('ended', R.onEnded);
        track.removeEventListener('mute', R.onMute);
        track.removeEventListener('unmute', R.onMute);
        giveUp(e);
        return;
      }
      if (ac) {
        try {
          R.src = ac.createMediaStreamSource(stream);
          R.an = ac.createAnalyser();
          R.an.fftSize = 2048;
          R.an.smoothingTimeConstant = 0;
          R.src.connect(R.an);
          R.buf = new Float32Array(R.an.fftSize);
          ac.resume?.()?.catch?.(() => {});
        } catch (e) { R.an = null; }
      }
      S.R = R;
      S.phase = 'recording';
      S.perm = 'granted';
      S.muted = !!track.muted;
      S.silent = false;
      S.clipAt = 0;
      S.view = 'rec';
      bus.emit('media:pause');              /* so the song playing in Music isn't in the take */
      refreshDevices();
      paint();
      kick();
      say('Recording');
    }

    function togglePause() {
      const R = S.R;
      if (!R || !canPause()) return;
      if (S.phase === 'recording') {
        try { R.rec.pause(); } catch (err) { return; }
        R.activeMs += performance.now() - R.segStart;
        R.segStart = 0;
        S.phase = 'paused';
        say('Paused');
      } else if (S.phase === 'paused') {
        try { R.rec.resume(); } catch (err) { return; }
        R.segStart = performance.now();
        S.phase = 'recording';
        say('Recording');
      }
      paint();
      paintSlow();
    }

    async function askDiscard() {
      const R = S.R;
      if (!R) return;
      const ok = await api.confirm({ title: 'Discard this take?',
        message: `The ${lengthText(activeMs(R))} recorded so far will be thrown away, not saved. This can’t be undone.`, ok: 'Discard', danger: true });
      if (!ok || S.dead || S.R !== R) return;
      finish('discard');
    }

    /** The microphone goes off now: every track stopped, the analyser closed. */
    /* ---- the screen: what the browser's picker shares, plus the mic if asked ---- */
    async function startScreen() {
      const pre = precheck('screen');
      if (pre) { fail(pre); return; }
      pausePlayback();
      pausePreview();
      const md = navigator.mediaDevices;
      /* made inside the click, so the browser lets it run */
      const AC = window.AudioContext || window.webkitAudioContext;
      let ac = null;
      try { ac = AC ? new AC() : null; } catch (err) { ac = null; }
      S.pendingAc = ac;
      const gen = ++S.gen;
      S.phase = 'asking';
      S.problem = null;
      S.notice = null;
      paint();
      let display = null, err = null;
      /* getDisplayMedia first, before any other await: it needs the click */
      try { display = await md.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: true }); } catch (e) { err = e; }
      let mic = null, micErr = null;
      if (display && S.narrate && gen === S.gen && !S.dead) {
        try {
          mic = await md.getUserMedia({ audio: { ...(S.deviceId ? { deviceId: S.deviceId } : {}), echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
        } catch (e) { micErr = e; }
      }
      const stopAll = () => { display?.getTracks().forEach(t => t.stop()); mic?.getTracks().forEach(t => t.stop()); };
      if (gen !== S.gen || S.dead) {
        stopAll();
        closeAc(ac);
        if (S.pendingAc === ac) S.pendingAc = null;
        return;
      }
      S.pendingAc = null;
      if (!display) { closeAc(ac); fail(screenProblem(err)); return; }
      const vtrack = display.getVideoTracks()[0];
      if (!vtrack) { stopAll(); closeAc(ac); fail(screenProblem(new DOMException('No video track', 'NotReadableError'))); return; }
      /* every sound source mixed into one track: a recorder keeps only one */
      const sounds = [...display.getAudioTracks(), ...(mic ? mic.getAudioTracks() : [])];
      let an = null, buf = null, dest = null;
      const nodes = [];
      if (ac && sounds.length) {
        try {
          dest = ac.createMediaStreamDestination();
          an = ac.createAnalyser();
          an.fftSize = 2048;
          an.smoothingTimeConstant = 0;
          for (const t of sounds) {
            const n = ac.createMediaStreamSource(new MediaStream([t]));
            n.connect(dest);
            n.connect(an);
            nodes.push(n);
          }
          buf = new Float32Array(an.fftSize);
          ac.resume?.()?.catch?.(() => {});
        } catch (e) { dest = null; an = null; }
      }
      const audioOut = dest ? dest.stream.getAudioTracks() : sounds.slice(0, 1);
      const out = new MediaStream([vtrack, ...audioOut]);
      const type = VC.videoRecorderType();
      const st = (vtrack.getSettings && vtrack.getSettings()) || {};
      const vbps = Math.max(1_500_000, Math.min(8_000_000, Math.round((st.width || 1280) * (st.height || 720) * 30 * 0.08)));
      let rec = null, recErr = null;
      for (const o of [type ? { mimeType: type, videoBitsPerSecond: vbps, audioBitsPerSecond: 128000 } : { videoBitsPerSecond: vbps }, type ? { mimeType: type } : null, {}]) {
        if (!o) continue;
        try { rec = new MediaRecorder(out, o); break; } catch (e) { recErr = e; rec = null; }
      }
      const all = new MediaStream([...display.getTracks(), ...(mic ? mic.getTracks() : []), ...(dest ? dest.stream.getTracks() : [])]);
      const giveUp = e => {
        all.getTracks().forEach(t => t.stop());
        closeAc(ac);
        fail({ kind: 'failed', icon: 'alert', title: 'Recording couldn’t start',
          body: `The browser’s recorder refused to start: “${e?.message || 'no details'}” (${e?.name || 'Error'}). Press Try again; if it keeps happening, reload StaticOS.` });
      };
      if (!rec) { giveUp(recErr); return; }
      const now = performance.now();
      const R = {
        kind: 'video', rec, stream: all, track: vtrack, ac, an, buf, preview: new MediaStream([vtrack]),
        src: { disconnect: () => nodes.forEach(n => { try { n.disconnect(); } catch (e) { /* gone */ } }) },
        chunks: [], bytes: 0, type: rec.mimeType || type || '', when: new Date(),
        activeMs: 0, segStart: now, levels: [], cur: null,
        settings: st, label: vtrack.label || '', mic: mic ? shortLabel(mic.getAudioTracks()[0]?.label || 'Microphone') : '',
        shared: display.getAudioTracks().length > 0, hasAudio: audioOut.length > 0, w: st.width || 0, h: st.height || 0,
        error: null, disp: -Infinity, hold: -Infinity, holdAt: 0, zeroMs: 0, lastNow: now,
      };
      R.stopped = new Promise(res => rec.addEventListener('stop', res, { once: true }));
      R.onData = e => { if (e.data && e.data.size) { R.chunks.push(e.data); R.bytes += e.data.size; } };
      R.onError = e => { R.error = e?.error || e; if (S.R === R) finish('error'); };
      R.onEnded = () => { if (S.R === R) finish('ended'); };
      R.onMute = () => {};
      rec.addEventListener('dataavailable', R.onData);
      rec.addEventListener('error', R.onError);
      vtrack.addEventListener('ended', R.onEnded);         /* the browser's own "Stop sharing" */
      try { rec.start(1000); } catch (e) {
        vtrack.removeEventListener('ended', R.onEnded);
        giveUp(e);
        return;
      }
      S.R = R;
      S.phase = 'recording';
      S.muted = false;
      S.silent = false;
      S.clipAt = 0;
      S.view = 'rec';
      if (micErr) S.notice = { tone: 'warn', text: `Recording without narration — the microphone couldn’t start (${micProblem(micErr).title.toLowerCase()}).` };
      else if (!R.hasAudio) S.notice = { tone: 'info', text: 'Recording the picture only: nothing shared any sound. To include it, share a tab with “Share tab audio” ticked, or turn on narration.' };
      bus.emit('media:pause');
      paint();
      kick();
      say('Recording the screen');
    }

    function releaseMic(R) {
      R.track.removeEventListener('ended', R.onEnded);
      R.track.removeEventListener('mute', R.onMute);
      R.track.removeEventListener('unmute', R.onMute);
      try { R.src?.disconnect(); } catch (err) { /* already gone */ }
      try { R.stream.getTracks().forEach(t => t.stop()); } catch (err) { /* already stopped */ }
      closeAc(R.ac);
      R.src = R.an = R.ac = R.buf = null;
    }

    /** Stop a take and keep it (or not). why: user | discard | closed | ended | error */
    async function finish(why) {
      const R = S.R;
      if (!R) return;
      S.R = null;
      /* read now: the big button is disabled while saving, which drops its focus */
      const hadFocus = !S.dead && appEl.contains(document.activeElement);
      const ms = activeMs(R);
      R.activeMs = ms;
      R.segStart = 0;
      if (R.cur !== null) { R.levels.push(R.cur); R.cur = null; }
      try { if (R.rec.state !== 'inactive') R.rec.stop(); } catch (err) { /* already stopped */ }
      releaseMic(R);                      /* the browser's microphone light goes out here */
      S.muted = false;
      S.silent = false;
      if (!S.dead) {
        S.phase = why === 'discard' ? 'idle' : 'saving';
        paint();
        paintSlow();
      }
      let wait = 0;
      await Promise.race([R.stopped, new Promise(res => { wait = setTimeout(res, 4000); })]);
      clearTimeout(wait);
      R.rec.removeEventListener('dataavailable', R.onData);
      R.rec.removeEventListener('error', R.onError);

      const isVid = R.kind === 'video';
      const what = isVid ? 'video' : 'audio';
      const reason = why === 'closed' ? 'The Recorder closed while recording, so the take was finished and saved.'
        : why === 'ended' ? (isVid ? 'Sharing stopped (the browser’s “Stop sharing”, or the shared window closed), so recording stopped.'
          : 'The microphone stopped (unplugged, switched off or taken by another app), so recording stopped.')
          : why === 'error' ? `The recorder hit an error (${R.error?.name || R.error?.message || 'unknown'}); this is what it kept.` : '';
      const end = (notice, notifyTitle) => {
        if (!S.dead) {
          S.phase = 'idle';
          S.notice = notice;
          paint();
          say(notice.text);
          if (hadFocus) refocus(bigBtn);
        } else if (notifyTitle) api.notify({ app: APP, icon: 'mic', title: notifyTitle, message: notice.text, timeout: 9000 });
      };

      if (why === 'discard') {
        R.chunks = [];
        end({ tone: 'info', text: `Discarded ${lengthText(ms)} of ${what}. Nothing was saved.` });
        return;
      }
      const type = R.rec.mimeType || R.type || R.chunks[0]?.type || '';
      let blob = new Blob(R.chunks, { type });
      R.chunks = [];
      if (!blob.size) {
        end({ tone: 'err', text: `Nothing was recorded — the browser handed back no ${what}${R.error ? ` (${R.error.name || R.error})` : ''}.` }, 'Nothing was recorded');
        return;
      }
      if (ms < MIN_MS) {
        end({ tone: 'warn', text: `That take was ${(Math.floor(ms / 100) / 10).toFixed(1)} s — too short to keep. Recordings need at least 1 second.` }, 'Recording too short to keep');
        return;
      }
      /* a voice take is decoded once for its exact length and waveform; a
         screen take's length is the recording time the clock measured */
      const kind = isVid ? await sniffVideo(blob) : await sniff(blob);
      const info = !isVid && ms <= DECODE_MAX_MS ? await analyse(blob) : null;
      const len = info && info.ms > 0 ? info.ms : ms;
      if (kind.ext === 'weba' || kind.ext === 'webm') blob = await withDuration(blob, len);
      const name = `${isVid ? 'Screen recording' : 'Recording'} ${stamp(R.when)}.${kind.ext}`;
      const DEST = isVid ? VDIR : DIR;
      let saved;
      try {
        saved = await media.save(DEST, name, blob);
      } catch (err) {
        const text = `The recording couldn’t be saved: ${err?.message || err}`;
        if (!S.dead) {
          S.phase = 'idle';
          S.notice = { tone: 'err', text: `${text} You can still download it.`, actions: [{ label: 'Download', fn: () => downloadBlob(blob, name, reg) }] };
          paint();
          say(text);
        }
        api.notify({ app: APP, icon: 'alert', title: 'Recording not saved', message: `${text} You can still download it.`,
          actions: [{ label: 'Download', onClick: () => downloadBlob(blob, name) }], timeout: 20000 });
        return;
      }
      /* the vfs calls .weba and .m4a 'bin'; this is audio, and Files should open it in Music */
      const want = isVid ? 'video' : 'audio';
      if (saved.node && saved.node.kind !== want) {
        saved.node.kind = want;
        bus.emit('fs:change', vfs.parentPath(saved.path), saved.path);
      }
      const mime = blob.type || kind.mime;
      addItem(isVid ? {
        id: saved.id, kind: 'video', path: saved.path, ms: len, size: blob.size, mime, fmt: describeVideo(mime, kind.ext),
        at: R.when.toISOString(), peaks: encodePeaks(resample(R.levels, PEAKS)), w: R.w, h: R.h, aud: R.hasAudio, mic: R.mic,
      } : {
        id: saved.id, path: saved.path, ms: len, size: blob.size, mime, fmt: describe(mime, kind.ext),
        at: R.when.toISOString(), peaks: info?.peaks || encodePeaks(resample(R.levels, PEAKS)),
        rate: R.settings.sampleRate || 0, ch: R.settings.channelCount || 0, mic: shortLabel(R.label),
      });
      const fname = vfs.baseName(saved.path);
      const volatile = db.persistent === false;
      if (!S.dead) {
        S.phase = 'idle';
        S.notice = volatile ? { tone: 'warn', text: 'This browser isn’t keeping files between visits (a private window?), so download the recordings you want to keep.' } : null;
        reconcile();
        select(saved.id, { focusPlay: hadFocus || appEl.contains(document.activeElement) });
        say(`Saved ${stemOf(fname)}, ${lengthText(len)}, to ${isVid ? 'Videos' : 'Music'}`);
      }
      if (S.dead || why !== 'user') {
        api.notify({
          app: APP, icon: isVid ? 'video' : 'mic', title: isVid ? 'Screen recording saved' : 'Recording saved',
          message: `${reason ? `${reason} ` : ''}${fname} · ${clock(len)} · ${bytes(blob.size)}`,
          actions: [
            isVid ? { label: 'Trim and caption', onClick: () => api.openApp('recorder', { path: saved.path }) }
              : { label: 'Play in Music', onClick: () => { if (vfs.node(saved.path)) api.openApp('music', { path: saved.path }); } },
            { label: 'Show in Files', onClick: () => api.openApp('files', { path: vfs.node(saved.path) ? saved.path : DEST }) },
          ],
          timeout: reason ? 12000 : 6000,
        });
      }
    }

    /* ============================ playback ============================ */
    const audio = new Audio();
    audio.preload = 'metadata';

    async function loadAudio(it) {
      const token = ++P.token;
      audio.pause();
      P.id = it.id;
      P.err = null;
      P.dur = it.ms / 1000;
      P.playing = false;
      if (audio.getAttribute('src')) { audio.removeAttribute('src'); try { audio.load(); } catch (err) { /* nothing loaded */ } }
      let url = null;
      try { url = await media.urlOf(it.path); } catch (err) { url = null; }
      if (S.dead || token !== P.token) return;
      if (!url) { P.err = 'missing'; paintItem(); return; }
      audio.src = url;
      audio.playbackRate = S.speed;
      paintItem();
    }
    function unloadAudio() {
      P.token++;
      audio.pause();
      P.id = null;
      P.playing = false;
      P.err = null;
      if (audio.getAttribute('src')) { audio.removeAttribute('src'); try { audio.load(); } catch (err) { /* nothing loaded */ } }
    }
    function pausePlayback() { if (!audio.paused) audio.pause(); }

    /* A voice effect kept as a new recording, next to the one it came from. */
    async function saveEffect({ blob, label, item }) {
      const kind = await sniff(blob);
      let out = blob;
      const info = await analyse(blob);
      const len = info && info.ms > 0 ? info.ms : item.ms;
      if (kind.ext === 'weba' || kind.ext === 'webm') out = await withDuration(blob, len);
      const dir = vfs.node(vfs.parentPath(item.path)) ? vfs.parentPath(item.path) : DIR;
      const saved = await media.save(dir, `${stemOf(item.name)} (${label}).${kind.ext}`, out);
      if (saved.node && saved.node.kind !== 'audio') {
        saved.node.kind = 'audio';
        bus.emit('fs:change', vfs.parentPath(saved.path), saved.path);
      }
      const mime = out.type || kind.mime;
      addItem({
        id: saved.id, path: saved.path, ms: len, size: out.size, mime, fmt: describe(mime, kind.ext),
        at: new Date().toISOString(), peaks: info?.peaks || '', rate: item.rate, ch: item.ch, mic: item.mic, src: item.id,
      });
      reconcile();
      if (!S.dead) paint();
      say(`Saved ${stemOf(vfs.baseName(saved.path))}`);
      return { name: vfs.baseName(saved.path), id: saved.id };
    }

    function togglePlay() {
      if (!P.id || P.err || !audio.getAttribute('src')) return;
      if (audio.paused || audio.ended) {
        if (audio.ended || (P.dur && audio.currentTime >= P.dur - 0.05)) audio.currentTime = 0;
        const pr = audio.play();
        pr?.catch?.(err => {
          if (S.dead || err?.name === 'AbortError') return;
          if (err?.name === 'NotSupportedError') { P.err = 'decode'; paintItem(); }
        });
      } else audio.pause();
    }
    function skip(sec) {
      if (!P.id || P.err || !audio.getAttribute('src')) return;
      const d = P.dur || 0;
      audio.currentTime = clamp((audio.currentTime || 0) + sec, 0, d || 0);
      paintPlayhead();
    }
    function cycleSpeed() {
      S.speed = SPEEDS[(SPEEDS.indexOf(S.speed) + 1) % SPEEDS.length];
      audio.playbackRate = S.speed;
      paintSpeed();
      say(`Speed ${S.speed}×`);
    }
    function paintSpeed() {
      speedBtn.textContent = `${S.speed}×`;
      speedBtn.setAttribute('aria-label', `Playback speed ${S.speed}×`);
      speedBtn.title = 'Playback speed';
      speedBtn.classList.toggle('is-on', S.speed !== 1);
    }

    const onMeta = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) P.dur = audio.duration;
      paintItem();
    };
    const onPlayState = () => {
      P.playing = !audio.paused && !audio.ended;
      if (S.dead) return;
      paintPlayBtn();
      paintList();
      paintPlayhead();
      if (P.playing) kick();
    };
    const onAudioErr = () => {
      if (!audio.getAttribute('src') || S.dead) return;
      P.err = 'decode';
      P.playing = false;
      paintItem();
      paintList();
    };
    const AUDIO_EVENTS = [['loadedmetadata', onMeta], ['durationchange', onMeta], ['play', onPlayState], ['pause', onPlayState],
      ['ended', onPlayState], ['playing', onPlayState], ['error', onAudioErr]];
    AUDIO_EVENTS.forEach(([ev, fn]) => audio.addEventListener(ev, fn));

    scrub.addEventListener('input', () => {
      if (!P.id || P.err) return;
      audio.currentTime = Number(scrub.value) || 0;
      paintPlayhead();
    });
    scrub.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        skip((e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 5));
      }
    });

    /* ============================ the recording view ============================ */
    let renameInput = null, renameErrEl = null, titleKey = '';
    function paintItem() {
      const it = current();
      if (!it || itemView.hidden) return;
      paintTitle(it);
      const isVid = it.kind === 'video';
      player.hidden = isVid;
      editor.hidden = !isVid;
      if (isVid) fx.hide(); else fx.show(it);
      const pl = isVid ? ['play', 'Play in Videos'] : ['music', 'Play in Music'];
      if (playElsewhere.dataset.tip !== pl[1]) {
        render(playElsewhere, icon(pl[0]));
        playElsewhere.dataset.tip = pl[1];
        playElsewhere.setAttribute('aria-label', pl[1]);
      }
      if (isVid) { paintEditor(); paintInfo(it); return; }
      const missing = P.id === it.id && P.err;
      fileWave.hidden = !!missing;
      fileMsg.hidden = !missing;
      clear(fileMsg);
      if (missing) {
        fileMsg.append(icon('alert'),
          h('b', { text: P.err === 'missing' ? 'The audio for this recording isn’t in this browser any more' : 'This browser can’t play this recording' }),
          h('small', { text: P.err === 'missing'
            ? 'The file is still listed in Music, but its bytes were cleared from this browser’s storage. Only the name is left.'
            : `It’s ${it.fmt || 'an audio file'} (${extOf(it.name).toUpperCase() || 'no extension'}), which this browser can’t decode. Download it to play it elsewhere.` }));
        if (P.err === 'missing') fileMsg.append(h('button.btn.btn--sm', { type: 'button', onclick: () => trash(it) }, icon('trash'), h('span', { text: 'Move to Trash' })));
      }
      [back5, fwd5, playBtn, speedBtn].forEach(b => { b.disabled = !!missing; });
      scrub.disabled = !!missing;
      paintPlayBtn();
      paintSpeed();
      paintPlayhead();
      paintInfo(it);
    }

    function paintTitle(it) {
      if (S.renaming) {
        if (!renameInput) {
          renameInput = h('input.rec-rename', { type: 'text', value: stemOf(it.name), maxlength: '120', 'aria-label': 'Recording name', spellcheck: 'false' });
          renameInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); commitRename(renameInput.value); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelRename(); }
          });
          renameErrEl = h('div.rec-renameerr', { role: 'alert' });
          clear(titleSlot);
          titleSlot.append(h('div.rec-renamewrap', renameInput,
            ibtn('check', 'Save name', () => commitRename(renameInput.value)),
            ibtn('x', 'Cancel', () => cancelRename())), renameErrEl);
          titleKey = '';
          requestAnimationFrame(() => { if (!S.dead && renameInput) { renameInput.focus(); renameInput.select(); } });
        }
        renameErrEl.textContent = S.renameErr;
        renameErrEl.hidden = !S.renameErr;
        renameInput.setAttribute('aria-invalid', S.renameErr ? 'true' : 'false');
        return;
      }
      renameInput = null;
      renameErrEl = null;
      const stem = stemOf(it.name);
      const sub = [whenText(it.at, h24()), it.ms ? clock(it.ms) : '', bytes(it.size)].filter(Boolean).join(' · ');
      const key = `${stem}|${sub}`;
      if (key === titleKey) return;
      titleKey = key;
      clear(titleSlot);
      titleSlot.append(
        h('button.rec-title', { type: 'button', title: 'Rename (F2)', 'aria-label': `${stem}. Rename`, onclick: () => startRename() },
          h('span.rec-title__t', { text: stem }), icon('edit-3')),
        h('div.rec-title__sub', { text: sub }));
    }

    function paintPlayBtn() {
      const playing = P.playing;
      clear(playGlyph);
      playGlyph.append(icon(playing ? 'pause' : 'play', { fill: true }));
      const label = playing ? 'Pause (Space)' : 'Play (Space)';
      playBtn.setAttribute('aria-label', label);
      playBtn.title = label;
      playBtn.classList.toggle('is-playing', playing);
    }

    let scrubAria = 0;
    function paintPlayhead() {
      const it = current();
      if (!it || itemView.hidden) return;
      const dur = P.id === it.id && P.dur ? P.dur : it.ms / 1000;
      const t = P.id === it.id ? Math.min(audio.currentTime || 0, dur || 0) : 0;
      curEl.textContent = clock(t * 1000);
      durEl.textContent = clock(dur * 1000);
      scrub.max = String(Math.max(0, dur));
      if (document.activeElement !== scrub || !P.playing) scrub.value = String(t);
      const now = performance.now();
      if (!P.playing || now - scrubAria > 500) {
        scrubAria = now;
        scrub.setAttribute('aria-valuetext', `${clock(t * 1000)} of ${clock(dur * 1000)}`);
      }
      drawFile();
    }

    let infoKey = '';
    function paintInfo(it) {
      const key = JSON.stringify([it.id, it.name, it.path, it.size, it.ms, it.at, it.fmt, it.mic, it.w, it.h, it.src, h24()]);
      if (key === infoKey) return;
      infoKey = key;
      const row = (k, v) => [h('dt', { text: k }), h('dd', v)];
      if (it.kind === 'video') {
        const d = new Date(it.at);
        const where = vfs.parentPath(it.path);
        const whereText = where === VDIR ? 'Videos' : where.startsWith(`${vfs.HOME}/`) ? where.slice(vfs.HOME.length + 1).split('/').join(' › ') : where;
        const orig = it.src ? readData().items.find(x => x.id === it.src) : null;
        const kbps = it.ms > 0 && it.size ? Math.round((it.size * 8) / it.ms) : 0;
        const rowsV = [
          row('Length', it.ms ? lengthText(it.ms) : 'Unknown'),
          row('Size', `${bytes(it.size)}${kbps ? ` · about ${kbps} kbps` : ''}`),
          row('Format', `${it.fmt || describeVideo(it.mime, extOf(it.name))} (.${extOf(it.name) || '?'})`),
          it.w && it.h ? row('Picture', `${it.w}×${it.h}`) : [],
          row('Sound', it.aud ? (it.mic && !it.src ? `Yes · narrated with ${it.mic}` : 'Yes') : 'None'),
          row(it.src ? 'Exported' : 'Recorded', Number.isNaN(d.getTime()) ? 'Unknown' : d.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short', hour12: !h24() })),
          it.src ? row('Edited from', orig ? h('button.rec-where', { type: 'button', onclick: () => { if (S.items.some(x => x.id === orig.id)) select(orig.id); } },
            icon('film'), h('span', { text: vfs.baseName(orig.path) })) : 'A recording that’s no longer here') : [],
          row('Where', h('button.rec-where', { type: 'button', title: 'Show in Files', onclick: () => showInFiles(it) },
            icon('folder'), h('span', { text: `${whereText} › ${it.name}` }))),
        ];
        clear(infoEl);
        infoEl.append(...rowsV.flat());
        return;
      }
      const kbps = it.ms > 0 && it.size ? Math.round((it.size * 8) / it.ms) : 0;
      const input = [it.mic, it.rate ? `${Math.round(it.rate / 100) / 10} kHz` : '', it.ch ? (it.ch === 1 ? 'mono' : it.ch === 2 ? 'stereo' : `${it.ch} channels`) : '']
        .filter(Boolean).join(' · ');
      const d = new Date(it.at);
      const where = vfs.parentPath(it.path);
      const whereText = where === DIR ? 'Music' : where.startsWith(`${vfs.HOME}/`) ? where.slice(vfs.HOME.length + 1).split('/').join(' › ') : where;
      const rowsOut = [
        row('Length', it.ms ? lengthText(it.ms) : 'Unknown'),
        row('Size', `${bytes(it.size)}${kbps ? ` · about ${kbps} kbps` : ''}`),
        row('Format', `${it.fmt || describe(it.mime, extOf(it.name))} (.${extOf(it.name) || '?'})`),
        row('Recorded', Number.isNaN(d.getTime()) ? 'Unknown' : d.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short', hour12: !h24() })),
        input ? row('Input', input) : [],
        row('Where', h('button.rec-where', { type: 'button', title: 'Show in Files', onclick: () => showInFiles(it) },
          icon('folder'), h('span', { text: `${whereText} › ${it.name}` }))),
      ];
      clear(infoEl);
      infoEl.append(...rowsOut.flat());
    }

    /* ============================ the video editor ============================
       E holds the open video and the edit: the cut [a, b) and the caption
       {text, pos, from, to} in the source's own seconds. Edits are kept per
       video while this window is open (drafts), so going back to the list
       and returning doesn't lose them. Nothing is written until Export. */
    const E = { id: null, url: null, token: 0, dur: 0, w: 0, h: 0, a: 0, b: 0,
      cap: { text: '', pos: 'bottom', from: 0, to: 0, touched: false },
      err: null, playing: false, exp: null, note: null, stripFor: '', stripCtl: null, drag: null };
    const drafts = new Map();
    const capG = capCv.getContext('2d');
    const stripG = strip.getContext('2d');

    function saveDraft() {
      if (E.id && E.dur) drafts.set(E.id, { a: E.a, b: E.b, cap: { ...E.cap } });
    }
    function unloadEditor() {
      saveDraft();
      E.token++;
      E.stripCtl?.abort();
      E.stripCtl = null;
      E.stripFor = '';
      E.playing = false;
      E.id = null;
      E.url = null;
      E.err = null;
      E.dur = 0;
      try { vid.pause(); } catch (err) { /* nothing loaded */ }
      if (vid.getAttribute('src')) { vid.removeAttribute('src'); try { vid.load(); } catch (err) { /* nothing loaded */ } }
    }
    async function loadEditor(it) {
      if (E.id === it.id) return;
      if (E.exp) return;                         /* one export at a time; the list stays usable */
      unloadEditor();
      const token = E.token;
      E.id = it.id;
      E.dur = it.ms / 1000 || 0;
      E.w = it.w; E.h = it.h;
      E.note = null;
      const d = drafts.get(it.id);
      E.a = d ? d.a : 0;
      E.b = d ? d.b : E.dur;
      E.cap = d ? { ...d.cap } : { text: '', pos: 'bottom', from: 0, to: E.dur, touched: false };
      let url = null;
      try { url = await media.urlOf(it.path); } catch (err) { url = null; }
      if (S.dead || token !== E.token) return;
      if (!url) { E.err = 'missing'; paintItem(); return; }
      E.url = url;
      vid.src = url;
      paintItem();
    }
    /* the file's own header is the authority on length and size */
    function onVidMeta() {
      if (!E.id) return;
      if (Number.isFinite(vid.duration) && vid.duration > 0) {
        const was = E.dur;
        E.dur = vid.duration;
        const d = drafts.get(E.id);
        if (!d) {
          if (!E.b || Math.abs(E.b - was) < 0.05) E.b = E.dur;
          if (!E.cap.touched) { E.cap.from = E.a; E.cap.to = E.b; }
        }
        E.b = Math.min(E.b || E.dur, E.dur);
      }
      if (vid.videoWidth) { E.w = vid.videoWidth; E.h = vid.videoHeight; }
      E.err = null;
      paintEditor();
      buildStrip();
    }
    const onVidErr = () => { if (!E.id || !vid.getAttribute('src')) return; E.err = 'decode'; E.playing = false; paintItem(); };
    const onVidTime = () => { if (!E.playing) paintEditorTime(); };
    const onVidState = () => {
      const playing = !vid.paused && !vid.ended;
      if (playing === E.playing) return;
      E.playing = playing;
      paintEdPlay();
      if (playing) kick();
    };
    const VID_EVENTS = [['loadedmetadata', onVidMeta], ['durationchange', onVidMeta], ['error', onVidErr], ['seeked', onVidTime], ['timeupdate', onVidTime],
      ['play', onVidState], ['pause', onVidState], ['ended', onVidState], ['playing', onVidState]];
    VID_EVENTS.forEach(([ev, fn]) => vid.addEventListener(ev, fn));

    const canEdit = () => !!E.id && !!E.url && !E.err && E.dur > 0 && !E.exp;
    function pausePreview() { if (!vid.paused) vid.pause(); }
    /** Preview plays the cut only, from its start (or from the playhead, if that is inside it). */
    function togglePreview() {
      if (!canEdit()) return;
      if (!vid.paused) { vid.pause(); return; }
      const t = vid.currentTime || 0;
      if (t < E.a - 0.01 || t >= E.b - 0.05) vid.currentTime = E.a;
      const pr = vid.play();
      pr?.catch?.(err => { if (!S.dead && err?.name === 'NotSupportedError') { E.err = 'decode'; paintItem(); } });
    }
    /* called from the frame loop while the preview plays */
    function editorFrame() {
      if (!E.playing) return;
      if ((vid.currentTime || 0) >= E.b - 0.01) { vid.pause(); vid.currentTime = E.b; }
      paintEditorTime();
    }
    function seek(t) {
      if (!canEdit()) return;
      vid.currentTime = clamp(t, 0, E.dur);
      paintEditorTime();
    }

    function setIn(t) {
      if (!canEdit()) return;
      const follow = !E.cap.touched;
      E.a = clamp(Math.round(t * 100) / 100, 0, Math.max(0, E.b - MIN_CUT));
      if (follow) { E.cap.from = E.a; E.cap.to = E.b; }
      if (vid.paused) seek(E.a);
      paintEditor();
    }
    function setOut(t) {
      if (!canEdit()) return;
      const follow = !E.cap.touched;
      E.b = clamp(Math.round(t * 100) / 100, Math.min(E.dur, E.a + MIN_CUT), E.dur);
      if (follow) { E.cap.from = E.a; E.cap.to = E.b; }
      if (vid.paused) seek(Math.max(E.a, E.b - 0.04));
      paintEditor();
    }
    function setCap(patch) {
      if (!canEdit()) return;
      const c = { ...E.cap, ...patch };
      if (!VC.CAPTION_POS.includes(c.pos)) c.pos = 'bottom';
      c.from = clamp(Number(c.from) || 0, 0, E.dur);
      c.to = clamp(Number(c.to) || 0, 0, E.dur);
      if (c.to < c.from + 0.1) {
        if ('from' in patch) c.to = Math.min(E.dur, c.from + 0.1);
        else c.from = Math.max(0, c.to - 0.1);
      }
      E.cap = c;
      /* show the caption where it will appear */
      if (('from' in patch || 'to' in patch) && vid.paused) seek('to' in patch && !('from' in patch) ? Math.max(c.from, c.to - 0.04) : c.from);
      paintEditor();
    }
    function resetEdit() {
      if (!canEdit()) return;
      E.a = 0;
      E.b = E.dur;
      E.cap = { text: '', pos: 'bottom', from: 0, to: E.dur, touched: false };
      capText.value = '';
      drafts.delete(E.id);
      E.note = null;
      seek(0);
      paintEditor();
      say('Edit reset');
    }

    /* ---- painting ---- */
    const pct = t => `${(E.dur ? clamp(t / E.dur, 0, 1) * 100 : 0).toFixed(3)}%`;
    function paintEdPlay() {
      clear(edGlyph);
      edGlyph.append(icon(E.playing ? 'pause' : 'play', { fill: true }));
      const label = E.playing ? 'Pause preview (Space)' : 'Preview the cut (Space)';
      edPlay.setAttribute('aria-label', label);
      edPlay.title = label;
      edPlay.classList.toggle('is-playing', E.playing);
    }
    let tlAria = 0;
    function paintEditorTime() {
      if (editor.hidden) return;
      const t = vid.currentTime || 0;
      edNow.textContent = VC.clockText(t, true);
      head.style.left = pct(t);
      const now = performance.now();
      if (!E.playing || now - tlAria > 500) {
        tlAria = now;
        head.setAttribute('aria-valuetext', `${VC.clockText(t, true)} of ${VC.clockText(E.dur, true)}`);
        head.setAttribute('aria-valuenow', String(Math.round(t * 10) / 10));
      }
      drawCapOverlay(t);
    }
    function fitCap() {
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const w = Math.max(0, Math.round(edScreen.clientWidth * dpr)), hh = Math.max(0, Math.round(edScreen.clientHeight * dpr));
      if (capCv.width !== w) capCv.width = w;
      if (capCv.height !== hh) capCv.height = hh;
    }
    /* the same drawing the export burns in, at the size it is shown */
    function drawCapOverlay(t = vid.currentTime || 0) {
      const W = capCv.width, H = capCv.height;
      capG.clearRect(0, 0, W, H);
      if (W && H && VC.captionShowing(E.cap, t)) VC.drawCaption(capG, W, H, E.cap);
    }
    function paintEditor() {
      const it = current();
      if (!it || it.kind !== 'video' || editor.hidden) return;
      const bad = E.err;
      edMsg.hidden = !bad;
      edScreen.hidden = !!bad;
      clear(edMsg);
      if (bad) {
        edMsg.append(icon('alert'),
          h('b', { text: bad === 'missing' ? 'The video for this recording isn’t in this browser any more' : 'This browser can’t play this video' }),
          h('small', { text: bad === 'missing'
            ? 'The file is still listed, but its bytes were cleared from this browser’s storage. Only the name is left.'
            : `It’s ${it.fmt || 'a video file'} (${extOf(it.name).toUpperCase() || 'no extension'}), which this browser can’t decode. Download it to play it elsewhere.` }));
        if (bad === 'missing') edMsg.append(h('button.btn.btn--sm', { type: 'button', onclick: () => trash(it) }, icon('trash'), h('span', { text: 'Move to Trash' })));
      }
      if (E.w && E.h) edScreen.style.setProperty('--ar', String(E.w / E.h));
      const ready = canEdit();
      const busy = !!E.exp;
      for (const el of [edPlay, hIn, hOut, head, resetBtn, capText, ...posBtns, inF.input, outF.input, capFromF.input, capToF.input,
        ...editor.querySelectorAll('.rec-ed__take')]) el.disabled = !ready;
      exportBtn.disabled = !ready;
      cancelBtn.hidden = !busy;
      progEl.hidden = !busy;
      exportBtn.hidden = busy;
      editor.classList.toggle('is-exporting', busy);
      /* the timeline */
      shadeL.style.width = pct(E.a);
      shadeR.style.left = pct(E.b);
      selBox.style.left = pct(E.a);
      selBox.style.width = `calc(${pct(E.b)} - ${pct(E.a)})`;
      const hasCap = !!E.cap.text.trim();
      capBand.hidden = !hasCap;
      capBand.style.left = pct(E.cap.from);
      capBand.style.width = `calc(${pct(E.cap.to)} - ${pct(E.cap.from)})`;
      capBand.title = hasCap ? `Caption ${VC.clockText(E.cap.from, true)}–${VC.clockText(E.cap.to, true)}` : '';
      hIn.style.left = pct(E.a);
      hOut.style.left = pct(E.b);
      for (const [hb, v] of [[hIn, E.a], [hOut, E.b]]) {
        hb.setAttribute('aria-valuemin', '0');
        hb.setAttribute('aria-valuemax', String(Math.round(E.dur * 10) / 10));
        hb.setAttribute('aria-valuenow', String(Math.round(v * 10) / 10));
        hb.setAttribute('aria-valuetext', VC.clockText(v, true));
      }
      head.setAttribute('aria-valuemin', '0');
      head.setAttribute('aria-valuemax', String(Math.round(E.dur * 10) / 10));
      /* fields: never overwrite one that is being typed in */
      const put = (inp, v) => { if (document.activeElement !== inp) { inp.value = VC.clockText(v, true); inp.removeAttribute('aria-invalid'); } };
      put(inF.input, E.a); put(outF.input, E.b); put(capFromF.input, E.cap.from); put(capToF.input, E.cap.to);
      if (document.activeElement !== capText && capText.value !== E.cap.text) capText.value = E.cap.text;
      for (const b of posBtns) {
        const on = b.dataset.pos === E.cap.pos;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
      }
      const cut = Math.max(0, E.b - E.a);
      edCut.textContent = E.dur ? `Cut ${VC.clockText(cut, true)} of ${VC.clockText(E.dur, true)}` : '';
      paintEdPlay();
      paintEditorTime();
      paintEdNote();
      if (busy) paintExportProgress();
      if (E.url && E.dur && E.stripFor !== stripKey()) buildStrip();
    }
    let edNoteKey = '';
    function paintEdNote() {
      const n = E.note;
      const key = n ? `${n.tone}|${n.text}` : '';
      if (key === edNoteKey) return;
      edNoteKey = key;
      clear(edNote);
      edNote.hidden = !n;
      if (!n) return;
      edNote.dataset.tone = n.tone;
      edNote.append(icon(n.tone === 'err' || n.tone === 'warn' ? 'alert' : n.tone === 'ok' ? 'check-circle' : 'info'),
        h('span.rec-note__t', { text: n.text }),
        ...(n.actions || []).map(a => h('button.btn.btn--sm', { type: 'button', onclick: a.fn }, a.label)));
    }
    function paintExportProgress() {
      const f = E.exp ? E.exp.frac : 0;
      progFill.style.width = `${(f * 100).toFixed(1)}%`;
      progEl.setAttribute('aria-valuenow', String(Math.round(f * 100)));
      progEl.dataset.label = `Exporting… ${Math.round(f * 100)}%`;
    }

    /* the filmstrip: real frames from the file, rebuilt when the width changes */
    const stripKey = () => `${E.id}|${strip.clientWidth}|${strip.clientHeight}|${Math.round(E.dur * 10)}`;
    let stripT = 0;
    function buildStrip() {
      clearTimeout(stripT);
      stripT = setTimeout(async () => {
        if (S.dead || !E.url || !E.dur || editor.hidden) return;
        const key = stripKey();
        if (key === E.stripFor) return;
        E.stripFor = key;
        E.stripCtl?.abort();
        const ctl = typeof AbortController === 'function' ? new AbortController() : null;
        E.stripCtl = ctl;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const W = Math.round(strip.clientWidth * dpr), H = Math.round(strip.clientHeight * dpr);
        if (!W || !H) { E.stripFor = ''; return; }
        strip.width = W;
        strip.height = H;
        stripG.clearRect(0, 0, W, H);
        const aspect = E.w && E.h ? E.w / E.h : 16 / 9;
        const n = Math.max(1, Math.min(24, Math.ceil(W / (H * aspect))));
        let pic = null;
        try { pic = await VC.filmstrip(E.url, E.dur, n, H, ctl?.signal); } catch (err) { pic = null; }
        if (S.dead || E.stripCtl !== ctl || E.stripFor !== key) return;
        stripG.clearRect(0, 0, W, H);
        if (pic) {
          /* each frame stretched to its slot so the strip spans the timeline exactly */
          const slot = W / n, tw = pic.width / n;
          for (let i = 0; i < n; i++) stripG.drawImage(pic, i * tw, 0, tw, pic.height, Math.round(i * slot), 0, Math.ceil(slot), H);
        }
        strip.classList.toggle('is-empty', !pic);
      }, 120);
    }

    /* ---- dragging on the timeline: a handle trims, anywhere else scrubs ---- */
    const tAt = clientX => {
      const r = track.getBoundingClientRect();
      return r.width ? clamp((clientX - r.left) / r.width, 0, 1) * E.dur : 0;
    };
    track.addEventListener('pointerdown', e => {
      if (!canEdit() || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const kind = e.target.closest('[data-drag]')?.dataset.drag || 'head';
      e.preventDefault();
      pausePreview();
      E.drag = { id: e.pointerId, kind };
      try { track.setPointerCapture(e.pointerId); } catch (err) { /* released */ }
      (kind === 'in' ? hIn : kind === 'out' ? hOut : head).focus({ preventScroll: true });
      track.classList.add('is-dragging');
      if (kind === 'head') seek(tAt(e.clientX));
    });
    track.addEventListener('pointermove', e => {
      if (!E.drag || e.pointerId !== E.drag.id) return;
      const t = tAt(e.clientX);
      if (E.drag.kind === 'in') setIn(t);
      else if (E.drag.kind === 'out') setOut(t);
      else seek(t);
    });
    const endDrag = e => {
      if (!E.drag || e.pointerId !== E.drag.id) return;
      E.drag = null;
      track.classList.remove('is-dragging');
    };
    track.addEventListener('pointerup', endDrag);
    track.addEventListener('pointercancel', endDrag);
    /* keyboard: ←/→ move by a tenth of a second (Shift: a second), Home/End to the ends */
    function sliderKey(e, kind) {
      if (!canEdit()) return;
      const step = e.shiftKey ? NUDGE_BIG : NUDGE;
      const cur = kind === 'in' ? E.a : kind === 'out' ? E.b : (vid.currentTime || 0);
      let next = null;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = cur - step;
      else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = cur + step;
      else if (e.key === 'Home') next = kind === 'head' ? E.a : 0;
      else if (e.key === 'End') next = kind === 'head' ? E.b : E.dur;
      if (next === null) return;
      e.preventDefault();
      e.stopPropagation();
      pausePreview();
      if (kind === 'in') setIn(next); else if (kind === 'out') setOut(next); else seek(next);
    }
    hIn.addEventListener('keydown', e => sliderKey(e, 'in'));
    hOut.addEventListener('keydown', e => sliderKey(e, 'out'));
    head.addEventListener('keydown', e => sliderKey(e, 'head'));

    capText.addEventListener('input', () => {
      E.cap = { ...E.cap, text: capText.value.slice(0, VC.CAPTION_MAX) };
      if (vid.paused && E.cap.text.trim() && !VC.captionShowing(E.cap, vid.currentTime || 0)) seek(E.cap.from);
      paintEditor();
    });

    /* ---- export: a new file next to the original ---- */
    async function exportEdit() {
      const it = current();
      if (!it || it.kind !== 'video' || !canEdit()) return;
      if (!VC.canCut()) {
        E.note = { tone: 'err', text: 'This browser can’t re-encode video here (it has no MediaRecorder for video, or no canvas capture), so the cut can’t be exported. The edit is kept while this window stays open.' };
        paintEditor();
        return;
      }
      pausePreview();
      const ctl = new AbortController();
      const from = it, a = E.a, b = E.b;
      const cap = E.cap.text.trim() ? { text: E.cap.text.trim(), pos: E.cap.pos, from: E.cap.from, to: E.cap.to } : null;
      E.exp = { ctl, frac: 0 };
      E.note = { tone: 'info', text: `Exporting ${VC.clockText(b - a, true)} — the cut plays through once, out of sight, while it is re-encoded. Keep this tab open.` };
      paintEditor();
      say('Exporting');
      let res = null, fail = null;
      try {
        res = await VC.exportCut({ url: E.url, a, b, cap, signal: ctl.signal,
          onProgress: f => { if (E.exp && E.exp.ctl === ctl) { E.exp.frac = f; paintExportProgress(); } } });
      } catch (err) { fail = err; }
      if (S.dead) return;
      E.exp = null;
      if (fail) {
        E.note = fail.code === 'abort' ? { tone: 'info', text: 'Export cancelled. Nothing was saved.' }
          : { tone: 'err', text: `The export didn’t finish: ${fail.message || fail}` };
        paintEditor();
        say(E.note.text);
        return;
      }
      const ext = /mp4/.test(res.mime) ? 'mp4' : 'webm';
      const dir = vfs.node(vfs.parentPath(from.path)) ? vfs.parentPath(from.path) : VDIR;
      const name = `${stemOf(from.name)} (edited).${ext}`;
      let saved;
      try {
        saved = await media.save(dir, name, res.blob);
      } catch (err) {
        E.note = { tone: 'err', text: `The edited video couldn’t be saved: ${err?.message || err}. You can still download it.`,
          actions: [{ label: 'Download', fn: () => downloadBlob(res.blob, name, reg) }] };
        paintEditor();
        return;
      }
      if (saved.node && saved.node.kind !== 'video') { saved.node.kind = 'video'; bus.emit('fs:change', vfs.parentPath(saved.path), saved.path); }
      addItem({
        id: saved.id, kind: 'video', path: saved.path, ms: res.ms, size: res.blob.size, mime: res.mime, fmt: describeVideo(res.mime, ext),
        at: new Date().toISOString(), peaks: '', w: res.w, h: res.h, aud: res.audio, src: from.id,
      });
      const fname = vfs.baseName(saved.path);
      const where = dir === VDIR ? 'Videos' : tildeOf(dir);
      E.note = { tone: 'ok', text: `Saved “${fname}” — ${lengthText(res.ms)}, ${bytes(res.blob.size)} — in ${where}${cap ? ', with the caption' : ''}. “${from.name}” is unchanged.`,
        actions: [
          { label: 'Open it', fn: () => select(saved.id, { focusPlay: true }) },
          { label: 'Show in Files', fn: () => api.openApp('files', { path: vfs.node(saved.path) ? saved.path : dir }) },
        ] };
      reconcile();
      paint();
      say(`Exported ${stemOf(fname)}`);
      if (!win.el.classList.contains('is-active')) {
        api.notify({ app: APP, icon: 'film', title: 'Video exported', message: `${fname} · ${clock(res.ms)} · ${bytes(res.blob.size)}`, timeout: 8000,
          actions: [{ label: 'Play in Videos', onClick: () => { if (vfs.node(saved.path)) api.openFile(saved.path, api.getApp('videos') ? 'videos' : undefined); } }] });
      }
    }
    const tildeOf = p => (p === vfs.HOME ? '~' : p.startsWith(`${vfs.HOME}/`) ? `~${p.slice(vfs.HOME.length)}` : p);

    /* ---- rename ---- */
    function startRename() {
      if (!current()) return;
      S.renaming = true;
      S.renameErr = '';
      renameInput = null;
      paintItem();
    }
    function cancelRename() {
      S.renaming = false;
      S.renameErr = '';
      paintItem();
      requestAnimationFrame(() => titleSlot.querySelector('.rec-title')?.focus());
    }
    function commitRename(value) {
      const it = current();
      if (!it) return;
      const node = vfs.node(it.path);
      if (!node) { S.renameErr = 'This recording isn’t there any more.'; paintItem(); return; }
      const ext = extOf(node.name);
      let stem = String(value || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (ext && stem.toLowerCase().endsWith(`.${ext}`)) stem = stem.slice(0, -(ext.length + 1)).trim();
      stem = stem.slice(0, 120);
      if (!stem) { S.renameErr = 'A name can’t be empty.'; paintItem(); return; }
      if (stem.startsWith('.')) { S.renameErr = 'A name can’t start with a dot (that hides the file).'; paintItem(); return; }
      const next = ext ? `${stem}.${ext}` : stem;
      if (next === node.name) { cancelRename(); return; }
      const dir = vfs.parentPath(it.path);
      if (vfs.node(`${dir}/${next}`)) { S.renameErr = `There’s already a file called “${next}” there.`; paintItem(); return; }
      if (!vfs.rename(it.path, next)) { S.renameErr = 'That name couldn’t be used.'; paintItem(); return; }
      const path = `${dir}/${next}`;
      const n2 = vfs.node(path);
      if (n2 && n2.kind !== 'audio' && media.kindOf(next) === 'audio') { n2.kind = 'audio'; bus.emit('fs:change', dir, path); }
      patchItem(it.id, { path });
      S.renaming = false;
      S.renameErr = '';
      reconcile();
      paint();
      say(`Renamed to ${stem}`);
      requestAnimationFrame(() => titleSlot.querySelector('.rec-title')?.focus());
    }

    /* ---- file actions ---- */
    async function download(it) {
      if (!it) return;
      let blob = null;
      try { blob = await media.blobOf(it.path); } catch (err) { blob = null; }
      if (S.dead) return;
      if (!blob) { S.notice = { tone: 'err', text: `There’s nothing stored for “${it.name}” any more, so there is nothing to download.` }; paint(); return; }
      downloadBlob(blob, vfs.baseName(it.path), reg);
      say(`Downloading ${it.name}`);
    }
    function openInMusic(it) { if (it && vfs.node(it.path)) api.openApp('music', { path: it.path }); }
    /** a voice take plays in Music, a video in Videos */
    function openElsewhere(it) {
      if (!it || !vfs.node(it.path)) return;
      if (it.kind !== 'video') { openInMusic(it); return; }
      pausePreview();
      api.openFile(it.path, api.getApp('videos') ? 'videos' : undefined);
    }
    function showInFiles(it) { if (it) api.openApp('files', { path: vfs.node(it.path) ? it.path : (it.kind === 'video' ? VDIR : DIR) }); }

    function trash(it, { focusNext = false } = {}) {
      if (!it) return;
      const node = vfs.node(it.path);
      if (!node) return;
      const i = S.items.findIndex(x => x.id === it.id);
      const neighbour = S.items[i + 1] || S.items[i - 1] || null;
      const dir = vfs.parentPath(it.path), name = node.name;
      if (P.id === it.id) unloadAudio();
      if (E.id === it.id) { if (E.exp) return; unloadEditor(); }
      if (!vfs.rm(it.path)) { S.notice = { tone: 'err', text: `“${name}” couldn’t be moved to the Trash.` }; paint(); return; }
      const wasSel = S.sel === it.id;
      reconcile();
      if (wasSel) {
        if (neighbour && S.items.some(x => x.id === neighbour.id)) select(neighbour.id);
        else { S.sel = null; S.view = 'rec'; }
      }
      paint();
      if (focusNext) focusRow(neighbour?.id || null);
      say(`${stemOf(name)} moved to the Trash`);
      api.notify({
        app: APP, icon: 'trash', title: 'Moved to the Trash', message: name, timeout: 7000,
        actions: [{ label: 'Undo', onClick: () => {
          /* only if it is still sitting in the Trash, untouched */
          const tp = `${TRASH}/${node.name}`;
          if (vfs.node(tp) !== node || !vfs.node(dir)) return;
          if (!vfs.mv(tp, dir)) return;
          if (node.name !== name && !vfs.node(`${dir}/${name}`)) vfs.rename(`${dir}/${node.name}`, name);
          if (node.kind !== 'audio' && media.kindOf(node.name) === 'audio') { node.kind = 'audio'; bus.emit('fs:change', dir, `${dir}/${node.name}`); }
        } }],
      });
    }

    /* ============================ painting ============================ */
    function paint() {
      if (S.dead) return;
      paintPanes();
      paintList();
      if (!recView.hidden) paintRec();
      if (!itemView.hidden) paintItem();
      paintSlow();
    }

    /* ============================ wiring ============================ */
    let fsT = 0;
    offs.push(bus.on('fs:change', () => {
      if (fsT) return;
      fsT = after(120, () => { fsT = 0; if (S.dead) return; reconcile(); paint(); });
    }));
    offs.push(store.sub(STORE_KEY, () => { if (writing || S.dead) return; reconcile(); paint(); }));

    const onKey = e => {
      if (S.dead || !win.el.classList.contains('is-active') || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && t !== document.body && !win.el.contains(t)) return;
      const tag = t && t.tagName;
      if ((tag === 'INPUT' && t.type !== 'range') || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return;
      const k = (e.key || '').toLowerCase();
      if (k === 'r') {
        e.preventDefault();
        if (e.repeat) return;
        if (S.R) finish('user');
        else if (S.phase !== 'asking' && S.phase !== 'saving') { showRecorder(); startRecording(); }
      } else if (k === 'p' && S.R) {
        e.preventDefault();
        if (!e.repeat) togglePause();
      } else if ((e.key === ' ' || e.code === 'Space') && !itemView.hidden && tag !== 'BUTTON') {
        e.preventDefault();
        if (!e.repeat) { if (current()?.kind === 'video') togglePreview(); else togglePlay(); }
      } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !itemView.hidden && tag !== 'INPUT' && !t?.closest?.('.rec-list')) {
        e.preventDefault();
        const d = e.key === 'ArrowLeft' ? -1 : 1;
        if (current()?.kind === 'video') { pausePreview(); seek((vid.currentTime || 0) + d * (e.shiftKey ? NUDGE : NUDGE_BIG)); }
        else skip(d * 5);
      } else if ((k === 'i' || k === 'o') && !itemView.hidden && current()?.kind === 'video') {
        /* mark the cut's start / end at the playhead, as video editors do */
        e.preventDefault();
        if (k === 'i') setIn(vid.currentTime || 0); else setOut(vid.currentTime || 0);
      }
    };
    window.addEventListener('keydown', onKey);

    const onDevices = () => refreshDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', onDevices);

    /* theme or accent changes recolour the canvases */
    const mo = new MutationObserver(() => { readColors(); drawLive(); drawFile(); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-accent', 'style', 'class'] });

    /* responsive: react to the real painted width */
    let ro = null;
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(entries => {
        for (const e of entries) {
          if (e.target === appEl) {
            const w = e.contentRect.width;
            /* a phone sheet is always one pane at a time, whatever its width */
            const n = w > 0 && (w < NARROW || document.body.classList.contains('is-mobile'));
            if (n !== S.narrow) {
              S.narrow = n;
              if (n && !S.R) S.pane = S.view === 'item' ? 'main' : S.pane;
              if (!S.dead) paint();
            }
          } else if (e.target === liveWave) { fit(liveCv); drawLive(); }
          else if (e.target === fileWave) { fit(fileCv); drawFile(); }
          else if (e.target === edScreen) { fitCap(); drawCapOverlay(); }
          else if (e.target === track) buildStrip();
        }
      });
      ro.observe(appEl);
      ro.observe(liveWave);
      ro.observe(fileWave);
      ro.observe(edScreen);
      ro.observe(track);
    }

    function openWith(o) {
      if (!o) return;
      const p = o.path ? vfs.norm(o.path) : null;
      if (p) {
        reconcile();
        const it = S.items.find(x => x.path === p);
        if (it) { select(it.id); return; }
      }
      if (o.view === 'rec' || o.record) showRecorder();
    }
    win.onReopen(o => openWith(o));

    /* ---------- first paint ---------- */
    readColors();
    reconcile();
    {
      const pre = precheck(S.source);
      if (pre) { S.phase = 'error'; S.problem = pre; }
    }
    paint();
    fit(liveCv);
    drawLive();
    if (!precheck()) { watchPermission(); refreshDevices(); }
    if (opts && (opts.path || opts.view)) openWith(opts);

    /* ---------- teardown ---------- */
    return () => {
      if (S.dead) return;
      S.dead = true;
      S.gen++;                                      /* a pending getUserMedia is void: its tracks stop when it lands */
      closeAc(S.pendingAc);
      S.pendingAc = null;
      if (S.R) finish('closed');                    /* stops every track now, then saves and notifies */
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      AUDIO_EVENTS.forEach(([ev, fn]) => audio.removeEventListener(ev, fn));
      E.exp?.ctl.abort();                           /* an export in progress stops; nothing half-made is saved */
      fx.destroy();
      unloadEditor();
      VID_EVENTS.forEach(([ev, fn]) => vid.removeEventListener(ev, fn));
      clearTimeout(stripT);
      audio.pause();
      audio.removeAttribute('src');
      try { audio.load(); } catch (err) { /* nothing loaded */ }
      offs.splice(0).forEach(off => { try { off(); } catch (err) { /* already off */ } });
      window.removeEventListener('keydown', onKey);
      navigator.mediaDevices?.removeEventListener?.('devicechange', onDevices);
      if (S.permStatus) { S.permStatus.onchange = null; S.permStatus = null; }
      mo.disconnect();
      if (ro) { ro.disconnect(); ro = null; }
      timers.forEach(clearTimeout);
      timers.clear();
      urls.forEach(u => URL.revokeObjectURL(u));
      urls.clear();
      rows.clear();
      peakCache.clear();
    };
  },
});
