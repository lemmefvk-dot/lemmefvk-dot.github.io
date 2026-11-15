/* ============================================================
   makerkit.js — the little things StaticOS's maker apps share
   (Flipbook, Logo maker, Wallpaper studio, Colour by number,
   Stop motion, Turtle).

     makerCss()                 load css/feat-makers.css once
     blobOf(canvas, type, q)    -> Promise<Blob>  (rejects when the browser can't make that type)
     frameData(canvas)          -> Uint8ClampedArray RGBA, for the GIF encoder
     stemName(text, fallback)   a file-name-safe name
     recordCanvases(...)        a WebM from drawn frames (MediaRecorder), or null when the browser can't

   Saving goes through js/photos/pt-common.js saveBlob (media.save + a
   notification with Open in Photos / Send with Drop / Show in Files),
   so every maker app keeps files the same way Picture Tools does.
   ============================================================ */

export function makerCss() {
  if (typeof document === 'undefined' || document.getElementById('feat-makers-css')) return;
  const l = document.createElement('link');
  l.id = 'feat-makers-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-makers.css';
  document.head.appendChild(l);
}

export function blobOf(canvas, type = 'image/png', quality) {
  return new Promise((res, rej) => {
    try {
      canvas.toBlob(b => (b && (type === 'image/png' || b.type === type) ? res(b) : rej(new Error('This browser can’t make that kind of file.'))), type, quality);
    } catch (e) { rej(e); }
  });
}

export function frameData(canvas) {
  return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
}

export const stemName = (text, fallback = 'Untitled') =>
  String(text || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || fallback;

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Play `canvases` (all one size) back at `fps` into a WebM. `onProgress(i, n)` per frame.
    Real time: a 5 s animation takes 5 s to write. Resolves null when MediaRecorder or
    canvas capture isn't there or can't make WebM. `cancel()` on the returned handle ends it early. */
export function recordCanvases(canvases, fps, onProgress = () => {}) {
  const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(t => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(t));
  const first = canvases[0];
  if (!type || !first || typeof first.captureStream !== 'function') return { done: Promise.resolve(null), cancel() {} };
  const stage = document.createElement('canvas');
  stage.width = first.width; stage.height = first.height;
  const g = stage.getContext('2d');
  g.drawImage(first, 0, 0);
  const stream = stage.captureStream(0);
  const track = stream.getVideoTracks()[0];
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 2_500_000 });
  const parts = [];
  let stopped = false, timer = 0;
  rec.ondataavailable = e => { if (e.data && e.data.size) parts.push(e.data); };
  const done = new Promise(res => {
    rec.onstop = () => { clearTimeout(timer); stream.getTracks().forEach(t => t.stop()); res(parts.length ? new Blob(parts, { type: 'video/webm' }) : null); };
    rec.onerror = () => res(null);
  });
  rec.start();
  let i = 0;
  const step = () => {
    if (stopped) return;
    if (i >= canvases.length) { setTimeout(() => { if (rec.state !== 'inactive') rec.stop(); }, 1000 / fps); return; }
    g.drawImage(canvases[i], 0, 0);
    if (track.requestFrame) track.requestFrame();
    onProgress(i + 1, canvases.length);
    i++;
    timer = setTimeout(step, 1000 / fps);
  };
  step();
  return { done, cancel() { stopped = true; clearTimeout(timer); if (rec.state !== 'inactive') rec.stop(); } };
}
