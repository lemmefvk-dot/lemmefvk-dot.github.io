/* ============================================================
   videocut.js — cut a video and burn a caption into it, in the
   browser, with nothing uploaded anywhere.

   There is no video encoder a page can call directly that also
   writes a file (WebCodecs encodes frames, but turning them into a
   playable .webm needs a muxer this project doesn't ship), so this
   uses the one complete path every current browser has:

     the source plays once, in real time, from the cut's start to its
     end, in an off-screen <video>; every frame is drawn to a canvas
     with the caption painted on top while its time range is showing;
     canvas.captureStream() plus the video's own sound (routed through
     Web Audio, so nothing comes out of the speakers) go into a
     MediaRecorder, and what it writes is the new file.

   So an export takes as long as the cut is, and the result is a new
   WebM (or MP4 where only that can be written). The source file is
   only read, never touched.

     videoRecorderType()            -> mime | '' | null (can't record video)
     probe(url)                     -> { dur, w, h }
     filmstrip(url, dur, n, th)     -> canvas strip of n frames (or null)
     drawCaption(g, W, H, cap)      -> paints cap {text,pos} at the size W×H
     exportCut({url,a,b,cap,...})   -> { blob, ms, w, h, mime, audio }
     withDuration(blob, ms)         -> the WebM with its length in the header
     parseClock('1:02.5')           -> 62.5   ·   clockText(62.5, true) -> '1:02.5'
   ============================================================ */

export const VTYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8',
  'video/webm', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4'];
export const CAPTION_MAX = 120;
export const CAPTION_POS = ['top', 'middle', 'bottom'];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const even = n => Math.max(2, Math.round(n / 2) * 2);

export class CutError extends Error {
  constructor(code, message) { super(message); this.name = 'CutError'; this.code = code; }
}

/** The first video container MediaRecorder can write here; '' = let it choose; null = it can't record video. */
export function videoRecorderType() {
  if (typeof MediaRecorder !== 'function') return null;
  if (typeof MediaRecorder.isTypeSupported !== 'function') return '';
  for (const t of VTYPES) {
    try { if (MediaRecorder.isTypeSupported(t)) return t; } catch (e) { /* keep looking */ }
  }
  return null;
}
export const canCut = () => videoRecorderType() !== null
  && typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function';

/** "1:02.5" / "62.5" / "1:02:03" -> seconds; NaN if it isn't a time */
export function parseClock(s) {
  const t = String(s ?? '').trim().replace(',', '.');
  if (!t) return NaN;
  if (!/^\d+(?::\d{1,2})*(?:\.\d+)?$/.test(t)) return NaN;
  const parts = t.split(':').map(Number);
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}
/** 62.5 -> "1:02" (or "1:02.5" with tenths) */
export function clockText(sec, tenths = false) {
  const t = Math.max(0, Number(sec) || 0);
  const whole = Math.floor(t + 1e-6);
  const hh = Math.floor(whole / 3600), mm = Math.floor((whole % 3600) / 60), ss = whole % 60;
  const p2 = n => String(n).padStart(2, '0');
  const base = hh ? `${hh}:${p2(mm)}:${p2(ss)}` : `${mm}:${p2(ss)}`;
  return tenths ? `${base}.${Math.floor(((t - whole) * 10) + 1e-6) % 10}` : base;
}

/** wait for one media event, with a timeout and an abort signal */
function once(el, evt, ms, signal) {
  return new Promise((resolve, reject) => {
    let t = 0;
    const off = () => { clearTimeout(t); el.removeEventListener(evt, ok); el.removeEventListener('error', bad); signal?.removeEventListener?.('abort', ab); };
    const ok = () => { off(); resolve(); };
    const bad = () => { off(); reject(new CutError('decode', 'This browser couldn’t read the video.')); };
    const ab = () => { off(); reject(new CutError('abort', 'Cancelled.')); };
    if (signal?.aborted) { ab(); return; }
    t = setTimeout(() => { off(); reject(new CutError('timeout', 'The video took too long to answer.')); }, ms);
    el.addEventListener(evt, ok);
    el.addEventListener('error', bad);
    signal?.addEventListener?.('abort', ab);
  });
}

function hiddenVideo(url) {
  const v = document.createElement('video');
  v.playsInline = true;
  v.preload = 'auto';
  v.setAttribute('aria-hidden', 'true');
  v.tabIndex = -1;
  /* parked off-screen, not detached: Chromium seeks and plays a detached
     element noticeably worse, and one that never paints can stall */
  v.style.cssText = 'position:fixed;left:-10000px;top:0;width:320px;height:180px;opacity:0;pointer-events:none';
  document.body.appendChild(v);
  v.src = url;
  return v;
}
function dropVideo(v) {
  try { v.pause(); } catch (e) { /* gone */ }
  v.removeAttribute('src');
  try { v.load(); } catch (e) { /* nothing loaded */ }
  v.remove();
}

/** A live MediaRecorder file can carry no length until it is read to the end. */
async function settleDuration(v) {
  if (Number.isFinite(v.duration) && v.duration > 0) return v.duration;
  const got = once(v, 'durationchange', 6000).catch(() => {});
  try { v.currentTime = 1e101; } catch (e) { /* not seekable */ }
  await got;
  const d = Number.isFinite(v.duration) ? v.duration : 0;
  try { v.currentTime = 0; } catch (e) { /* fine */ }
  return d;
}

/** Length and size of a video, read from the file. */
export async function probe(url) {
  const v = hiddenVideo(url);
  v.muted = true;
  try {
    await once(v, 'loadedmetadata', 15000);
    const dur = await settleDuration(v);
    return { dur, w: v.videoWidth, h: v.videoHeight };
  } finally { dropVideo(v); }
}

/** n frames across the video, side by side, each th px high — the timeline's picture. */
export async function filmstrip(url, dur, n, th, signal) {
  if (!(dur > 0) || n < 1) return null;
  const v = hiddenVideo(url);
  v.muted = true;
  try {
    await once(v, 'loadedmetadata', 15000, signal);
    if (!v.videoWidth || !v.videoHeight) return null;
    const tw = Math.max(1, Math.round((th * v.videoWidth) / v.videoHeight));
    const c = document.createElement('canvas');
    c.width = tw * n;
    c.height = th;
    const g = c.getContext('2d');
    for (let i = 0; i < n; i++) {
      const at = Math.min(dur - 0.05, ((i + 0.5) * dur) / n);
      const seeked = once(v, 'seeked', 5000, signal);
      v.currentTime = Math.max(0, at);
      try { await seeked; } catch (e) { if (e.code === 'abort') throw e; continue; }
      g.drawImage(v, i * tw, 0, tw, th);
    }
    return c;
  } catch (e) {
    if (e && e.code === 'abort') throw e;
    return null;
  } finally { dropVideo(v); }
}

/* ---------------- the caption ----------------
   Sized from the frame's height, so the preview (drawn on a canvas laid
   over the player at its on-screen size) and the export (drawn into the
   full-size frame) look the same: what you see is what you get. */
function wrap(g, text, maxW) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (g.measureText(next).width <= maxW || !line) line = next;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  /* a single word wider than the frame is cut with an ellipsis */
  return lines.map(l => {
    if (g.measureText(l).width <= maxW) return l;
    let s = l;
    while (s.length > 1 && g.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
    return `${s}…`;
  });
}
/** Where the caption box sits in a W×H frame (also what the tests read). */
export function captionBox(g, W, H, cap) {
  const fs = Math.max(10, Math.round(H * 0.056));
  g.font = `600 ${fs}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  const pad = Math.round(fs * 0.5);
  let lines = wrap(g, cap.text, W * 0.86 - pad * 2);
  if (lines.length > 3) lines = [...lines.slice(0, 2), `${lines[2].replace(/…$/, '')}…`];
  const lh = Math.round(fs * 1.25);
  const bw = Math.min(W * 0.92, Math.max(...lines.map(l => g.measureText(l).width)) + pad * 2);
  const bh = lines.length * lh + pad * 1.4;
  const margin = Math.round(H * 0.06);
  const y = cap.pos === 'top' ? margin : cap.pos === 'middle' ? Math.round((H - bh) / 2) : H - margin - bh;
  return { x: Math.round((W - bw) / 2), y, w: Math.round(bw), h: Math.round(bh), fs, lh, pad, lines };
}
export function drawCaption(g, W, H, cap) {
  if (!cap || !String(cap.text || '').trim()) return null;
  g.save();
  const b = captionBox(g, W, H, cap);
  const r = Math.round(b.fs * 0.35);
  g.fillStyle = 'rgba(0,0,0,0.66)';
  g.beginPath();
  if (typeof g.roundRect === 'function') g.roundRect(b.x, b.y, b.w, b.h, r);
  else g.rect(b.x, b.y, b.w, b.h);
  g.fill();
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  b.lines.forEach((l, i) => g.fillText(l, W / 2, b.y + b.pad * 0.7 + b.lh * (i + 0.5)));
  g.restore();
  return b;
}
export const captionShowing = (cap, t) => !!cap && !!String(cap.text || '').trim() && t >= cap.from - 1e-3 && t < cap.to;

/** about 0.1 bits per pixel per frame, between 1 and 8 Mbit/s */
const bitrate = (w, h, fps) => clamp(Math.round(w * h * fps * 0.1), 1_000_000, 8_000_000);

/**
 * Re-encode [a, b) of the video at `url`, with `cap` burnt in while it shows.
 * onProgress(fraction, t) is called as it plays through. `signal` cancels.
 */
export async function exportCut({ url, a, b, cap = null, fps = 30, maxSide = 1920, onProgress, signal }) {
  const type = videoRecorderType();
  if (type === null) throw new CutError('norec', 'This browser can’t write video files (MediaRecorder has no video format here), so the cut can’t be made.');
  if (typeof HTMLCanvasElement.prototype.captureStream !== 'function') throw new CutError('nocapture', 'This browser can’t turn a canvas into video (no captureStream), so the cut can’t be made.');
  if (!(b - a > 0.05)) throw new CutError('empty', 'The cut is empty — move the end after the start.');
  const v = hiddenVideo(url);
  let ac = null, rec = null, tracks = [], timer = 0, raf = 0;
  try {
    await once(v, 'loadedmetadata', 15000, signal);
    if (!v.videoWidth || !v.videoHeight) throw new CutError('novideo', 'There’s no picture in this file to cut.');
    const s = Math.min(1, maxSide / Math.max(v.videoWidth, v.videoHeight));
    const W = even(v.videoWidth * s), H = even(v.videoHeight * s);
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d');
    const vs = cv.captureStream(fps);
    tracks.push(...vs.getTracks());

    /* does the file have sound? The element's own capture says, without playing it */
    let audio = false;
    try {
      const probeStream = typeof v.captureStream === 'function' ? v.captureStream() : null;
      if (probeStream) {
        if (!probeStream.getAudioTracks().length) await new Promise(r => setTimeout(r, 120));
        audio = probeStream.getAudioTracks().length > 0;
        probeStream.getTracks().forEach(t => t.stop());
      }
    } catch (e) { audio = false; }
    let dest = null;
    if (audio) {
      const AC = window.AudioContext || window.webkitAudioContext;
      try {
        ac = new AC();
        const node = ac.createMediaElementSource(v);     /* the sound goes only to the recorder, not the speakers */
        dest = ac.createMediaStreamDestination();
        node.connect(dest);
        await ac.resume?.().catch?.(() => {});
        tracks.push(...dest.stream.getTracks());
      } catch (e) { dest = null; audio = false; }
    }
    const out = new MediaStream([...vs.getVideoTracks(), ...(dest ? dest.stream.getAudioTracks() : [])]);
    const bps = bitrate(W, H, fps);
    const tries = type
      ? [{ mimeType: type, videoBitsPerSecond: bps, audioBitsPerSecond: 128000 }, { mimeType: type }, {}]
      : [{ videoBitsPerSecond: bps }, {}];
    for (const o of tries) {
      try { rec = new MediaRecorder(out, o); break; } catch (e) { rec = null; }
    }
    if (!rec) throw new CutError('norec', 'The browser’s video recorder refused to start.');
    const chunks = [];
    rec.addEventListener('dataavailable', e => { if (e.data && e.data.size) chunks.push(e.data); });
    const stopped = new Promise(res => rec.addEventListener('stop', res, { once: true }));

    const draw = () => {
      g.drawImage(v, 0, 0, W, H);
      if (captionShowing(cap, v.currentTime)) drawCaption(g, W, H, cap);
    };
    const seeked = once(v, 'seeked', 15000, signal);
    v.currentTime = a;
    await seeked;
    draw();
    rec.start(250);
    const t0 = performance.now();
    try { await v.play(); } catch (e) {
      throw new CutError('play', `The browser wouldn’t play the video to re-encode it (${e?.name || 'error'}).`);
    }
    const span = b - a;
    await new Promise((resolve, reject) => {
      const fail = () => { cleanup(); reject(new CutError('decode', 'The video stopped playing partway through the export.')); };
      const abort = () => { cleanup(); reject(new CutError('abort', 'Cancelled.')); };
      const cleanup = () => { v.removeEventListener('error', fail); signal?.removeEventListener?.('abort', abort); cancelAnimationFrame(raf); clearTimeout(timer); };
      v.addEventListener('error', fail);
      signal?.addEventListener?.('abort', abort);
      const tick = () => {
        if (signal?.aborted) { abort(); return; }
        draw();
        const t = v.currentTime;
        onProgress?.(clamp((t - a) / span, 0, 1), t);
        if (t >= b - 0.5 / fps || v.ended) { cleanup(); resolve(); return; }
        /* a hidden tab gets no animation frames; keep drawing on a timer then */
        if (document.hidden) timer = setTimeout(tick, 1000 / fps);
        else raf = requestAnimationFrame(tick);
      };
      tick();
    });
    v.pause();
    draw();
    await new Promise(r => setTimeout(r, 1000 / fps));
    rec.stop();
    /* the file is as long as the recorder ran: measured, not assumed */
    const ran = performance.now() - t0;
    await Promise.race([stopped, new Promise(r => setTimeout(r, 4000))]);
    onProgress?.(1, b);
    const mime = String(rec.mimeType || type || 'video/webm').split(';')[0] || 'video/webm';
    let blob = new Blob(chunks, { type: mime });
    if (!blob.size) throw new CutError('empty', 'The recorder handed back no video.');
    const ms = ran > 0 ? ran : span * 1000;
    if (/webm/.test(mime)) blob = await withDuration(blob, ms);
    return { blob, ms, w: W, h: H, mime, audio };
  } finally {
    cancelAnimationFrame(raf);
    clearTimeout(timer);
    try { if (rec && rec.state !== 'inactive') rec.stop(); } catch (e) { /* already stopped */ }
    tracks.forEach(t => { try { t.stop(); } catch (e) { /* stopped */ } });
    try { ac?.close?.()?.catch?.(() => {}); } catch (e) { /* closed */ }
    dropVideo(v);
  }
}

/* ---------------- WebM: write the length into the header ----------------
   A live MediaRecorder writes an unknown-size Segment and no Duration in
   Info, so players show "Infinity" and can't seek. Only the head of the
   file is rewritten (Info gets a Duration element and a new size); the
   clusters are copied untouched. Anything unexpected returns the file as
   it came, which still plays. (Static Recorder's voice takes use it too.) */
const EBML_ID = 0x1A45DFA3, SEGMENT = 0x18538067, INFO = 0x1549A966, SCALE = 0x2AD7B1,
  DURATION = 0x4489, SEEKHEAD = 0x114D9B74, CLUSTER = 0x1F43B675;
function vintLen(first, max) {
  for (let len = 1, mask = 0x80; len <= max; len++, mask >>= 1) if (first & mask) return len;
  return 0;
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
export async function withDuration(blob, ms) {
  try {
    const b = new Uint8Array(await blob.slice(0, Math.min(blob.size, 65536)).arrayBuffer());
    const head = readId(b, 0);
    if (!head || head.id !== EBML_ID) return blob;
    const hs = readSize(b, head.len);
    if (!hs || hs.unknown) return blob;
    let i = head.len + hs.len + hs.size;
    const seg = readId(b, i);
    if (!seg || seg.id !== SEGMENT) return blob;
    const ss = readSize(b, i + seg.len);
    if (!ss || !ss.unknown) return blob;            /* only the live-writer shape is touched */
    i += seg.len + ss.len;
    while (i < b.length) {
      const el = readId(b, i);
      const sz = el && readSize(b, i + el.len);
      if (!el || !sz || sz.unknown) return blob;
      const at = i + el.len + sz.len, end = at + sz.size;
      /* a SeekHead holds byte offsets that the insert would break */
      if (el.id === SEEKHEAD || el.id === CLUSTER || end > b.length) return blob;
      if (el.id === INFO) {
        let scale = 1e6;
        for (let j = at; j < end;) {
          const c = readId(b, j);
          const cs = c && readSize(b, j + c.len);
          if (!c || !cs || cs.unknown) return blob;
          const cd = j + c.len + cs.len;
          if (cd + cs.size > end) return blob;
          if (c.id === DURATION) return blob;         /* already there */
          if (c.id === SCALE) { scale = 0; for (let k = 0; k < cs.size; k++) scale = scale * 256 + b[cd + k]; }
          j = cd + cs.size;
        }
        const dur = new Uint8Array(11);
        dur.set([0x44, 0x89, 0x88]);                   /* Duration, 8-byte float */
        new DataView(dur.buffer).setFloat64(3, (ms * 1e6) / (scale || 1e6));
        const body = b.subarray(at, end);
        return new Blob([b.subarray(0, i + el.len), size8(body.length + dur.length), body, dur, blob.slice(end)], { type: blob.type });
      }
      i = end;
    }
  } catch (err) { /* keep the recording as it came */ }
  return blob;
}

export default { videoRecorderType, canCut, probe, filmstrip, drawCaption, captionBox, captionShowing, exportCut, withDuration, parseClock, clockText, CutError };
