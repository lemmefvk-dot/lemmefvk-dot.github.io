/* ============================================================
   Slideshow maker (Picture Tools, #121) — pictures into a video.

   Pick pictures (in the order you pick them), a time for each slide, a
   transition between slides, an optional title and optional music from
   ~/Music. Preview plays it on the stage; Make video renders it.

   Transitions (each takes up to 0.6 s at the end of a slide, never more
   than half of it, laid over the start of the next, so the video is exactly
   slides × seconds long):
     Crossfade   the next picture fades in
     Slide       the next picture pushes the old one off to the left
     Zoom        Ken Burns: every slide creeps in 12 % while it is shown,
                 and slides crossfade
     None        a hard cut
   Pictures are cropped to fill the frame.

   Rendering: the same drawing code paints a canvas; captureStream() feeds a
   MediaRecorder, so the video is WebM (see js/core/videocut.js for why
   browsers can't write MP4 portably). The clock is real time: the render
   takes as long as the video does. Music is decoded with WebAudio,
   looped if it is shorter than the show, faded out over the last 1.5 s
   and mixed into the recording through a MediaStreamDestination. The
   preview plays the music too. Saved to ~/Videos.
   ============================================================ */
import { pickerView, blobOfSource, bitmapOf, sizeOfBitmap, sourceOfPath, saveBlob, clamp } from './pt-common.js';
import * as VC from '../core/videocut.js';
import * as media from '../core/media.js';
import vfs from '../core/vfs.js';

const SIZES = [[640, 360, '640 × 360'], [1280, 720, '1280 × 720 (HD)'], [1920, 1080, '1920 × 1080 (Full HD)']];
const TRANS = [['fade', 'Crossfade'], ['slide', 'Slide'], ['zoom', 'Zoom (Ken Burns)'], ['none', 'None']];
const TR_LEN = 0.6;
const KB = 0.12;
const FPS = 30;
const ease = p => p * p * (3 - 2 * p);

export const totalSeconds = (n, dur) => n * dur;

/** Paint the show at time t. slides: canvases already cropped to W×H.  o: { dur, trans, title } */
export function drawShow(g, W, H, slides, t, o) {
  const n = slides.length;
  g.globalAlpha = 1;
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  if (!n) return;
  const total = totalSeconds(n, o.dur);
  t = clamp(t, 0, total);
  const i = Math.min(n - 1, Math.floor(t / o.dur));
  const local = t - i * o.dur;
  const tr = o.trans === 'none' ? 0 : Math.min(TR_LEN, o.dur / 2);
  const put = (img, loc, dx, alpha) => {
    const k = o.trans === 'zoom' ? 1 + KB * clamp(loc / o.dur, 0, 1) : 1;
    g.globalAlpha = alpha;
    g.drawImage(img, dx + (W - W * k) / 2, (H - H * k) / 2, W * k, H * k);
    g.globalAlpha = 1;
  };
  if (tr > 0 && i < n - 1 && local > o.dur - tr) {
    const p = ease(clamp((local - (o.dur - tr)) / tr, 0, 1));
    const into = local - (o.dur - tr);
    if (o.trans === 'slide') { put(slides[i], local, -p * W, 1); put(slides[i + 1], 0, (1 - p) * W, 1); }
    else { put(slides[i], local, 0, 1); put(slides[i + 1], into, 0, p); }
  } else put(slides[i], local, 0, 1);
  const title = String(o.title || '').trim();
  if (title) {
    const span = Math.min(total, Math.max(2, Math.min(o.dur, 4)));
    if (t < span) {
      const a = Math.min(1, t / 0.3, (span - t) / 0.4);
      g.save();
      g.globalAlpha = clamp(a, 0, 1);
      const px = Math.round(H * 0.09);
      g.font = `700 ${px}px "Inter", system-ui, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      let size = px;
      while (g.measureText(title).width > W * 0.88 && size > 10) { size -= 2; g.font = `700 ${size}px "Inter", system-ui, sans-serif`; }
      g.lineWidth = Math.max(3, size / 7); g.lineJoin = 'round';
      g.strokeStyle = 'rgba(0,0,0,.75)';
      g.strokeText(title, W / 2, H * 0.82);
      g.fillStyle = '#fff';
      g.fillText(title, W / 2, H * 0.82);
      g.restore();
    }
  }
}

function listMusic() {
  const out = [];
  vfs.walk(`${vfs.HOME}/Music`, (n, p) => {
    if (n.type === 'file' && media.kindOf(n.name) === 'audio' && media.isMedia(n) && !p.includes('/Trash/')) out.push({ name: n.name, path: p });
  });
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function mountSlideshow({ api, root, opts }) {
  const { h, icon } = api;
  const O = { dur: 3, trans: 'fade', title: '', size: 0, music: '', vol: 80 };
  const S = { alive: true, seq: 0, slides: [], timer: 0, playing: false, t0: 0, from: 0, raf: 0, audio: null, rendering: null, resultUrl: '' };
  const fmtBytes = api.fmt.fmtBytes;
  const dims = () => ({ W: SIZES[O.size][0], H: SIZES[O.size][1] });
  const canCapture = VC.canCut();

  /* ---------- stage ---------- */
  const cv = h('canvas.pt-ss__cv', { width: 640, height: 360, role: 'img', 'aria-label': 'Slideshow preview' });
  const empty = h('div.pt__empty', icon('film'), h('b', { text: 'Pick pictures for the slideshow' }),
    h('small', { text: 'Choose them on the right, in the order you want them shown. Then press Play to preview, and Make video to save it.' }));
  const paper = h('div.pt-ss__paper', { hidden: true }, cv);
  const playBtn = h('button.ibtn', { type: 'button', 'aria-label': 'Play the preview', title: 'Play / pause', disabled: true, onclick: () => togglePlay() }, icon('play'));
  const scrub = h('input', { type: 'range', min: 0, max: 1000, value: 0, 'aria-label': 'Preview position', disabled: true,
    oninput: () => { const was = S.playing; stopPlay(); showAt(Number(scrub.value) / 1000 * total()); if (was) startPlay(); } });
  const clock = h('span.pt-ss__clock', { text: '0:00 / 0:00' });
  const bar = h('div.pt-ss__bar', playBtn, scrub, clock);
  const prog = h('progress.pt-conv__progress', { max: 1, value: 0, hidden: true, 'aria-label': 'Rendering progress' });
  const progText = h('div.pt__foot', { role: 'status', 'aria-live': 'polite' });
  const result = h('div.pt-gif__result', { hidden: true });
  const main = h('div.pt__col', h('div.pt__stage.pt-ss__stage', empty, h('div.pt-ss__box', paper, bar), result), h('div.pt-conv__progwrap', prog), progText);

  const total = () => totalSeconds(S.slides.length, O.dur);
  const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const drawOpts = () => ({ dur: O.dur, trans: O.trans, title: O.title });
  function showAt(t) {
    const { W, H } = dims();
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    drawShow(cv.getContext('2d'), W, H, S.slides, t, drawOpts());
    scrub.value = String(total() ? Math.round(t / total() * 1000) : 0);
    clock.textContent = `${mmss(t)} / ${mmss(total())}`;
    cv.dataset.t = t.toFixed(2);
  }

  /* ---------- preview ---------- */
  function startPlay() {
    if (!S.slides.length || S.rendering) return;
    if (Number(scrub.value) >= 999) scrub.value = '0';
    S.from = Number(scrub.value) / 1000 * total();
    S.t0 = performance.now();
    S.playing = true;
    playBtn.replaceChildren(icon('pause')); playBtn.setAttribute('aria-label', 'Pause the preview');
    playMusic(S.from);
    const loop = () => {
      if (!S.playing || !S.alive) return;
      const t = S.from + (performance.now() - S.t0) / 1000;
      if (t >= total()) { showAt(total()); stopPlay(); scrub.value = '1000'; return; }
      showAt(t);
      S.raf = setTimeout(loop, 1000 / FPS);
    };
    loop();
  }
  function stopPlay() {
    S.playing = false;
    clearTimeout(S.raf);
    playBtn.replaceChildren(icon('play')); playBtn.setAttribute('aria-label', 'Play the preview');
    if (S.audio) { try { S.audio.pause(); } catch (e) { /* nothing playing */ } }
  }
  const togglePlay = () => (S.playing ? stopPlay() : startPlay());
  async function playMusic(from) {
    if (!O.music) return;
    try {
      const url = await media.urlOf(O.music);
      if (!url || !S.playing) return;
      if (!S.audio) S.audio = new Audio();
      if (S.audio.dataset.src !== O.music) { S.audio.src = url; S.audio.dataset.src = O.music; S.audio.loop = true; }
      S.audio.volume = O.vol / 100;
      S.audio.currentTime = S.audio.duration ? from % S.audio.duration : 0;
      await S.audio.play();
    } catch (e) { /* a browser that won't autoplay stays silent; the render does not depend on it */ }
  }

  /* ---------- slides ---------- */
  function cover(bmp, W, H) {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const { w, h: hh } = sizeOfBitmap(bmp);
    const k = Math.max(W / w, H / hh);
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, (W - w * k) / 2, (H - hh * k) / 2, w * k, hh * k);
    return c;
  }
  function schedule() { clearTimeout(S.timer); S.timer = setTimeout(rebuild, 150); }
  async function rebuild() {
    const seq = ++S.seq;
    stopPlay();
    const list = picker.selected();
    const { W, H } = dims();
    const slides = [];
    progText.textContent = list.length ? 'Reading the pictures…' : '';
    for (const src of list) {
      try {
        const bmp = await bitmapOf(await blobOfSource(src));
        if (!S.alive || seq !== S.seq) return;
        slides.push(cover(bmp, W, H));
        bmp.close?.();
      } catch (err) { progText.textContent = `Skipped ${src.name}: ${err?.message || err}`; }
    }
    if (!S.alive || seq !== S.seq) return;
    for (const c of S.slides) c.width = c.height = 0;
    S.slides = slides;
    empty.hidden = slides.length > 0;
    paper.hidden = !slides.length;
    bar.hidden = !slides.length;
    playBtn.disabled = scrub.disabled = !slides.length;
    makeBtn.disabled = !slides.length || !canCapture || !!S.rendering;
    if (slides.length) {
      showAt(0);
      progText.textContent = `${slides.length} slide${slides.length === 1 ? '' : 's'} · ${total()} s · ${W}×${H}${O.music ? ' · with music' : ''}`;
    } else cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
  }

  /* ---------- render ---------- */
  async function render(silent = false) {
    if (S.rendering || !S.slides.length) return;
    if (!canCapture) { progText.textContent = 'This browser can’t record a canvas to video, so the slideshow can’t be rendered.'; return; }
    stopPlay();
    const ctl = { stop: false };
    S.rendering = ctl;
    makeBtn.disabled = true; cancelBtn.hidden = false;
    prog.hidden = false; prog.value = 0;
    const { W, H } = dims();
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const T = total();
    let ac = null, rec = null, timer = 0, note = silent ? ' The music couldn’t be recorded in this browser (its audio isn’t running), so the video has no sound.' : '', again = false;
    try {
      const vs = c.captureStream(FPS);
      const tracks = [...vs.getVideoTracks()];
      let src = null;
      if (O.music && !silent) {
        try {
          const AC = window.AudioContext || window.webkitAudioContext;
          ac = new AC();
          /* a browser with no working audio output can leave these waiting for ever: give up and render without sound */
          const within = (p, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} took too long`)), 8000))]);
          const buf = await within(ac.decodeAudioData(await (await media.blobOf(O.music)).arrayBuffer()), 'Reading the music');
          const dest = ac.createMediaStreamDestination();
          const gain = ac.createGain();
          src = ac.createBufferSource();
          src.buffer = buf; src.loop = true;
          src.connect(gain); gain.connect(dest);
          await within(Promise.resolve(ac.resume?.()), 'Starting audio');
          const now = ac.currentTime, v = O.vol / 100;
          gain.gain.setValueAtTime(v, now);
          gain.gain.setValueAtTime(v, now + Math.max(0, T - 1.5));
          gain.gain.linearRampToValueAtTime(0, now + T);
          tracks.push(...dest.stream.getAudioTracks());
        } catch (err) { note = ` The music couldn’t be added (${err?.message || err}), so the video has no sound.`; src = null; }
      }
      const out = new MediaStream(tracks);
      const type = VC.videoRecorderType();
      const bps = clamp(Math.round(W * H * FPS * 0.1), 1_000_000, 8_000_000);
      for (const o of (type ? [{ mimeType: type, videoBitsPerSecond: bps, audioBitsPerSecond: 128000 }, { mimeType: type }, {}] : [{ videoBitsPerSecond: bps }, {}])) {
        try { rec = new MediaRecorder(out, o); break; } catch (e) { rec = null; }
      }
      if (!rec) throw new Error('The browser’s video recorder refused to start.');
      const chunks = [];
      rec.addEventListener('dataavailable', e => { if (e.data && e.data.size) chunks.push(e.data); });
      const stopped = new Promise(res => rec.addEventListener('stop', res, { once: true }));
      drawShow(g, W, H, S.slides, 0, drawOpts());
      rec.start(250);
      src?.start();
      const t0 = performance.now();
      await new Promise(resolve => {
        const tickFn = () => {
          if (ctl.stop || !S.alive) { resolve(); return; }
          const t = (performance.now() - t0) / 1000;
          drawShow(g, W, H, S.slides, Math.min(t, T), drawOpts());
          prog.value = Math.min(1, t / T);
          progText.textContent = `Rendering ${mmss(Math.min(t, T))} of ${mmss(T)} — it plays through once, in real time. Keep this tab open.`;
          if (t >= T) { resolve(); return; }
          timer = setTimeout(tickFn, 1000 / FPS);
        };
        tickFn();
      });
      clearTimeout(timer);
      try { src?.stop(); } catch (e) { /* not started */ }
      drawShow(g, W, H, S.slides, T, drawOpts());
      await new Promise(r => setTimeout(r, 1000 / FPS + 20));
      const ran = performance.now() - t0;
      rec.stop();
      await Promise.race([stopped, new Promise(r => setTimeout(r, 4000))]);
      vs.getTracks().forEach(t => t.stop());
      if (ctl.stop || !S.alive) { progText.textContent = 'Cancelled. Nothing was saved.'; return; }
      const mime = String(rec.mimeType || type || 'video/webm').split(';')[0] || 'video/webm';
      let blob = new Blob(chunks, { type: mime });
      if (!blob.size) {
        if (src) { again = true; throw new Error('retry without music'); }          /* a recorder fed by audio that never runs writes nothing: start over without the music */
        throw new Error('The recorder handed back no video.');
      }
      if (/webm/.test(mime)) blob = await VC.withDuration(blob, Math.min(ran, T * 1000 + 200));
      const ext = /mp4/.test(mime) ? 'mp4' : 'webm';
      const name = `${(O.title.trim() || 'Slideshow').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 60)}.${ext}`;
      const path = await saveBlob(api, 'Picture Tools', `${vfs.HOME}/Videos`, name, blob, { title: 'Slideshow saved' });
      const node = vfs.node(path);
      if (node && node.kind !== 'video') { node.kind = 'video'; api.bus.emit('fs:change', vfs.parentPath(path), path); }
      if (!S.alive) return;
      showResult(blob, path);
      progText.textContent = `Saved ${vfs.baseName(path)} — ${mmss(T)}, ${fmtBytes(blob.size)}, in ~/Videos.${note}`;
    } catch (err) {
      if (!again) progText.textContent = `The slideshow couldn’t be rendered: ${err?.message || err}`;
    } finally {
      clearTimeout(timer);
      try { if (rec && rec.state !== 'inactive') rec.stop(); } catch (e) { /* stopped */ }
      try { ac?.close?.()?.catch?.(() => {}); } catch (e) { /* closed */ }
      S.rendering = null;
      if (S.alive) { prog.hidden = true; cancelBtn.hidden = true; makeBtn.disabled = !S.slides.length || !canCapture; }
    }
    if (again && S.alive) await render(true);
  }
  function showResult(blob, path) {
    if (S.resultUrl) URL.revokeObjectURL(S.resultUrl);
    S.resultUrl = URL.createObjectURL(blob);
    result.hidden = false;
    result.dataset.path = path;
    result.replaceChildren(h('small', { text: `Saved as ${vfs.baseName(path)} in ~/Videos` }),
      h('button.btn.btn--sm', { type: 'button', onclick: () => api.openApp('videos', { path }) }, icon('play'), h('span', { text: 'Play in Videos' })));
  }

  /* ---------- options ---------- */
  const picker = pickerView(api, { multi: true, label: 'Pictures for the slideshow', onChange: () => schedule() });
  const durIn = h('input', { type: 'number', min: 1, max: 30, step: 0.5, value: String(O.dur), 'aria-label': 'Seconds per slide',
    oninput: () => { const v = Number(durIn.value); if (!(v >= 1)) return; O.dur = clamp(v, 1, 30); if (S.slides.length) { stopPlay(); showAt(0); progText.textContent = `${S.slides.length} slides · ${total()} s`; } } });
  const transSel = h('select', { 'aria-label': 'Transition', onchange: () => { O.trans = transSel.value; if (S.slides.length) showAt(Number(scrub.value) / 1000 * total()); } },
    TRANS.map(([v, l]) => h('option', { value: v, text: l })));
  const titleIn = h('input', { type: 'text', maxlength: 80, placeholder: 'Optional title', 'aria-label': 'Title text',
    oninput: () => { O.title = titleIn.value; if (S.slides.length && !S.playing) showAt(Number(scrub.value) / 1000 * total()); } });
  const sizeSel = h('select', { 'aria-label': 'Video size', onchange: () => { O.size = Number(sizeSel.value); schedule(); } },
    SIZES.map(([, , l], i) => h('option', { value: String(i), text: l })));
  const music = listMusic();
  const musicSel = h('select', { 'aria-label': 'Music', onchange: () => { O.music = musicSel.value; if (S.audio) { S.audio.pause(); S.audio.dataset.src = ''; } } },
    h('option', { value: '', text: music.length ? 'No music' : 'No music (nothing in ~/Music yet)' }),
    music.map(m => h('option', { value: m.path, text: m.name })));
  const volOut = h('output', { text: `${O.vol}%` });
  const volIn = h('input', { type: 'range', min: 0, max: 100, step: 1, value: O.vol, 'aria-label': 'Music volume',
    oninput: () => { O.vol = Number(volIn.value); volOut.textContent = `${O.vol}%`; if (S.audio) S.audio.volume = O.vol / 100; } });
  const makeBtn = h('button.btn.btn--primary', { type: 'button', disabled: true, onclick: () => render() }, icon('film'), h('span', { text: 'Make video' }));
  const cancelBtn = h('button.btn', { type: 'button', hidden: true, onclick: () => { if (S.rendering) S.rendering.stop = true; } }, h('span', { text: 'Cancel' }));
  const side = h('div.pt__side',
    picker.el,
    h('div.pt__group', h('b.pt__label', { text: 'Slides' }),
      h('label.pt__line', h('span', { text: 'Seconds each' }), durIn),
      h('label.pt__line', h('span', { text: 'Transition' }), transSel),
      h('label.pt__line', h('span', { text: 'Title' }), titleIn),
      h('label.pt__line', h('span', { text: 'Size' }), sizeSel)),
    h('div.pt__group', h('b.pt__label', { text: 'Music' }), musicSel,
      h('label.pt__slider', h('span', { text: 'Volume' }), volIn, volOut)),
    canCapture ? null : h('small.pt__warn', { role: 'note', text: 'This browser can’t turn a canvas into video, so slideshows can be previewed but not saved.' }),
    h('div.pt__actions', makeBtn, cancelBtn),
    h('small.pt__hint', { text: 'The video is WebM. Browsers can only write WebM reliably (MP4 needs an encoder most browsers don’t expose to web pages), and every current browser and phone plays WebM. It is saved in ~/Videos and renders in real time, so a 30 second show takes 30 seconds.' }));
  root.append(h('div.pt__split', main, side));
  bar.hidden = true;

  const first = opts?.path && sourceOfPath(opts.path);
  if (first) picker.pick(first);

  return () => {
    S.alive = false;
    S.seq++;
    clearTimeout(S.timer); stopPlay();
    if (S.rendering) S.rendering.stop = true;
    if (S.audio) { S.audio.pause(); S.audio.removeAttribute('src'); S.audio = null; }
    if (S.resultUrl) URL.revokeObjectURL(S.resultUrl);
    picker.destroy();
    for (const c of S.slides) c.width = c.height = 0;
    S.slides = [];
  };
}
