/* ============================================================
   moviecut.js — join clips, title cards and music into one video,
   in the browser, with nothing uploaded anywhere.

   Like core/videocut.js this has no encoder to call, so it uses the
   one path every current browser has: the movie PLAYS through once,
   in real time. Each piece is drawn in turn onto one canvas (a title
   card, or a clip playing in an off-screen <video>, letterboxed), the
   sound of each clip and the music are mixed in Web Audio, and
   canvas.captureStream() + that mix go into a MediaRecorder. So an
   export takes as long as the movie is, and the result is a new WebM
   (or MP4 where only that can be written). The source files are only
   read.

     exportMovie({ segments, music, musicVol, fps, maxSide, onProgress, signal })
        segments: [{ type: 'video', url, a, b } | { type: 'title', text, secs, bg, fg }]
        music:    a Blob of the person's own audio file, or null
        -> { blob, ms, w, h, mime, music: boolean }
     titleColors   the card colours on offer
   ============================================================ */
import * as VC from './videocut.js';

export const titleColors = [
  { id: 'night', bg: '#0e0a10', fg: '#ffffff', label: 'Night' },
  { id: 'paper', bg: '#f6efe4', fg: '#241a14', label: 'Paper' },
  { id: 'rose', bg: '#b3122e', fg: '#ffffff', label: 'Rose' },
  { id: 'sea', bg: '#0b4f6c', fg: '#ffffff', label: 'Sea' },
];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const even = n => Math.max(2, Math.round(n / 2) * 2);

function wait(el, evt, ms, signal) {
  return new Promise((resolve, reject) => {
    let t = 0;
    const off = () => { clearTimeout(t); el.removeEventListener(evt, ok); el.removeEventListener('error', bad); signal?.removeEventListener?.('abort', ab); };
    const ok = () => { off(); resolve(); };
    const bad = () => { off(); reject(new VC.CutError('decode', 'This browser couldn’t read one of the videos.')); };
    const ab = () => { off(); reject(new VC.CutError('abort', 'Cancelled.')); };
    if (signal?.aborted) { ab(); return; }
    t = setTimeout(() => { off(); reject(new VC.CutError('timeout', 'A video took too long to answer.')); }, ms);
    el.addEventListener(evt, ok);
    el.addEventListener('error', bad);
    signal?.addEventListener?.('abort', ab);
  });
}
function hidden(url) {
  const v = document.createElement('video');
  v.playsInline = true;
  v.preload = 'auto';
  v.setAttribute('aria-hidden', 'true');
  v.tabIndex = -1;
  v.style.cssText = 'position:fixed;left:-10000px;top:0;width:320px;height:180px;opacity:0;pointer-events:none';
  document.body.appendChild(v);
  v.src = url;
  return v;
}
function drop(v) {
  try { v.pause(); } catch (e) { /* gone */ }
  v.removeAttribute('src');
  try { v.load(); } catch (e) { /* nothing loaded */ }
  v.remove();
}

function wrapLines(g, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const t = line ? `${line} ${word}` : word;
      if (line && g.measureText(t).width > maxW) { out.push(line); line = word; } else line = t;
    }
    out.push(line);
  }
  return out;
}
/** A title card, drawn at any size. `k` (0..1) fades the words in. */
export function drawTitle(g, W, H, seg, k = 1) {
  g.fillStyle = seg.bg || titleColors[0].bg;
  g.fillRect(0, 0, W, H);
  g.fillStyle = seg.fg || titleColors[0].fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const size = Math.round(H * 0.095);
  g.font = `700 ${size}px system-ui, sans-serif`;
  const lines = wrapLines(g, seg.text || '', W * 0.82).slice(0, 6);
  g.globalAlpha = clamp(k, 0, 1);
  lines.forEach((l, i) => g.fillText(l, W / 2, H / 2 + (i - (lines.length - 1) / 2) * size * 1.25));
  g.globalAlpha = 1;
}

export async function exportMovie({ segments, music = null, musicVol = 0.6, fps = 30, maxSide = 1280, onProgress, signal }) {
  const type = VC.videoRecorderType();
  if (type === null) throw new VC.CutError('norec', 'This browser can’t write video files (MediaRecorder has no video format here), so the movie can’t be made.');
  if (typeof HTMLCanvasElement.prototype.captureStream !== 'function') throw new VC.CutError('nocapture', 'This browser can’t turn a canvas into video (no captureStream), so the movie can’t be made.');
  const pieces = segments.filter(s => (s.type === 'title' ? s.secs > 0 : s.b - s.a > 0.05));
  if (!pieces.length) throw new VC.CutError('empty', 'There is nothing in the movie yet.');
  const total = pieces.reduce((n, s) => n + (s.type === 'title' ? s.secs : s.b - s.a), 0);

  /* the picture size comes from the first clip (a movie of only titles is 1280×720) */
  let W = 1280, H = 720;
  const firstVid = pieces.find(s => s.type === 'video');
  if (firstVid) {
    const v = hidden(firstVid.url);
    try { await wait(v, 'loadedmetadata', 15000, signal); if (v.videoWidth && v.videoHeight) { W = v.videoWidth; H = v.videoHeight; } } finally { drop(v); }
  }
  const s0 = Math.min(1, maxSide / Math.max(W, H));
  W = even(W * s0);
  H = even(H * s0);
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  const vs = cv.captureStream(fps);

  const AC = window.AudioContext || window.webkitAudioContext;
  let ac = null, dest = null, musicNode = null, rec = null, live = null;
  const tracks = [...vs.getTracks()];
  try {
    ac = new AC();
    dest = ac.createMediaStreamDestination();
    await Promise.race([ac.resume?.()?.catch?.(() => {}), new Promise(r => setTimeout(r, 1500))]);   /* never wait on a sound device that isn't there */
    tracks.push(...dest.stream.getTracks());
    if (music) {
      const buf = await ac.decodeAudioData(await music.arrayBuffer());
      const gain = ac.createGain();
      gain.gain.value = clamp(musicVol, 0, 1);
      musicNode = ac.createBufferSource();
      musicNode.buffer = buf;
      musicNode.connect(gain);
      gain.connect(dest);
    }
    const out = new MediaStream([...vs.getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const bps = Math.max(1_500_000, Math.min(8_000_000, Math.round(W * H * fps * 0.08)));
    for (const o of type ? [{ mimeType: type, videoBitsPerSecond: bps, audioBitsPerSecond: 128000 }, { mimeType: type }, {}] : [{ videoBitsPerSecond: bps }, {}]) {
      try { rec = new MediaRecorder(out, o); break; } catch (e) { rec = null; }
    }
    if (!rec) throw new VC.CutError('norec', 'The browser’s video recorder refused to start.');
    const chunks = [];
    rec.addEventListener('dataavailable', e => { if (e.data && e.data.size) chunks.push(e.data); });
    const stopped = new Promise(res => rec.addEventListener('stop', res, { once: true }));
    rec.start(250);
    const t0 = performance.now();
    musicNode?.start();
    let done = 0;                                     /* seconds of finished pieces */
    const frame = fn => new Promise((resolve, reject) => {
      let raf = 0, timer = 0;
      const cleanup = () => { cancelAnimationFrame(raf); clearTimeout(timer); };
      const tick = () => {
        if (signal?.aborted) { cleanup(); reject(new VC.CutError('abort', 'Cancelled.')); return; }
        if (fn()) { cleanup(); resolve(); return; }
        if (document.hidden) timer = setTimeout(tick, 1000 / fps); else raf = requestAnimationFrame(tick);
      };
      tick();
    });
    for (const seg of pieces) {
      if (seg.type === 'title') {
        const start = performance.now();
        await frame(() => {
          const el = (performance.now() - start) / 1000;
          drawTitle(g, W, H, seg, Math.min(1, el / 0.4));
          onProgress?.(clamp((done + el) / total, 0, 1));
          return el >= seg.secs;
        });
        done += seg.secs;
        continue;
      }
      const v = hidden(seg.url);
      let node = null;
      try {
        await wait(v, 'loadedmetadata', 15000, signal);
        try {
          node = ac.createMediaElementSource(v);      /* its sound goes to the movie, not the speakers */
          node.connect(dest);
        } catch (e) { node = null; }
        const seeked = wait(v, 'seeked', 15000, signal);
        v.currentTime = seg.a;
        await seeked;
        await v.play();
        await frame(() => {
          g.fillStyle = '#000';
          g.fillRect(0, 0, W, H);
          if (v.videoWidth) {
            const k = Math.min(W / v.videoWidth, H / v.videoHeight);
            g.drawImage(v, (W - v.videoWidth * k) / 2, (H - v.videoHeight * k) / 2, v.videoWidth * k, v.videoHeight * k);
          }
          const el = v.currentTime - seg.a;
          onProgress?.(clamp((done + el) / total, 0, 1));
          return v.currentTime >= seg.b - 0.5 / fps || v.ended;
        });
        done += seg.b - seg.a;
      } finally { try { node?.disconnect(); } catch (e) { /* gone */ } drop(v); }
    }
    await new Promise(r => setTimeout(r, 1000 / fps));
    rec.stop();
    const ran = performance.now() - t0;
    await Promise.race([stopped, new Promise(r => setTimeout(r, 4000))]);
    onProgress?.(1);
    const mime = String(rec.mimeType || type || 'video/webm').split(';')[0] || 'video/webm';
    let blob = new Blob(chunks, { type: mime });
    if (!blob.size) throw new VC.CutError('empty', 'The recorder handed back no video.');
    if (/webm/.test(mime)) blob = await VC.withDuration(blob, ran);
    live = { blob, ms: ran, w: W, h: H, mime, music: !!musicNode };
    return live;
  } finally {
    try { musicNode?.stop(); } catch (e) { /* not started */ }
    try { if (rec && rec.state !== 'inactive') rec.stop(); } catch (e) { /* stopped */ }
    tracks.forEach(t => { try { t.stop(); } catch (e) { /* stopped */ } });
    try { ac?.close?.()?.catch?.(() => {}); } catch (e) { /* closed */ }
  }
}

export default { exportMovie, drawTitle, titleColors };
