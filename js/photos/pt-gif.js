/* ============================================================
   GIF maker (Picture Tools, #111) — an animated GIF from pictures or a video.

   Pictures: every picture you pick is one frame, in the order you picked
   them, each shown for the delay you set. The frame shape is the first
   picture's; the others are cropped to fill it.
   Video: any video in ~/Videos (screen recordings from Recorder are saved
   there too) or one from this computer. Choose the start and end, the
   frames per second and the width; frames are read by seeking the video to
   each moment, so a 5 s clip at 10 fps is 50 pictures.

   Captions (top and bottom, in the meme font), Boomerang (forwards then
   backwards, so it loops without a jump) and Speed (0.25x to 4x) are
   applied to the frames that were read, so changing them is quick; only
   the size, the frame rate and the pictures or clip need the pictures
   read again. Opened with { paths: [...] } (Camera's burst) it starts with
   those pictures picked, in order.

   The file is written by js/core/gif.js (palette by median cut, optional
   dithering, LZW, a loop-forever block, and "only what changed" frames).
   The size shown while you adjust is a guess from encoding the first few
   frames; the real size appears after Make GIF. Saved to ~/Pictures.
   ============================================================ */
import { pickerView, blobOfSource, bitmapOf, sizeOfBitmap, sourceOfPath, picturesDir, saveBlob, stemOf, clamp } from './pt-common.js';
import { encodeGif, estimateGifSize } from '../core/gif.js';
import { MEME_FONT } from './pt-meme.js';
import * as media from '../core/media.js';
import vfs from '../core/vfs.js';
import { t } from '../core/i18n.js';

const MAX_FRAMES = 200;
const MAX_W = 640;
const tick = () => new Promise(r => setTimeout(r, 0));

/** Forwards, then back without repeating either end, so the loop has no stutter. Two frames already ping-pong. */
export function boomerangOf(frames, on) {
  if (!on || frames.length < 3) return frames;
  return [...frames, ...frames.slice(1, -1).reverse()];
}

function once(el, evt, ms) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => { off(); rej(new Error('The video took too long to answer.')); }, ms);
    const off = () => { clearTimeout(t); el.removeEventListener(evt, ok); el.removeEventListener('error', bad); };
    const ok = () => { off(); res(); };
    const bad = () => { off(); rej(new Error('This browser couldn’t read that video.')); };
    el.addEventListener(evt, ok); el.addEventListener('error', bad);
  });
}

export function listVideos() {
  const out = [];
  vfs.walk(`${vfs.HOME}/Videos`, (n, p) => {
    if (n.type === 'file' && media.kindOf(n.name) === 'video' && media.isMedia(n) && !p.includes('/Trash/')) {
      out.push({ key: p, name: n.name, path: p, at: Date.parse(n.mtime) || 0 });
    }
  });
  return out.sort((a, b) => b.at - a.at || a.name.localeCompare(b.name));
}

export function mountGif({ api, root, opts }) {
  const { h, icon } = api;
  const O = { mode: 'pictures', delay: 200, width: 320, fps: 10, start: 0, end: 5, dither: false, optimize: true, colors: 256, top: '', bottom: '', boomerang: false, speed: 1 };
  const S = { alive: true, seq: 0, timer: 0, fxTimer: 0, base: null, frames: [], dim: null, video: null, vurl: null, vdur: 0, play: 0, busy: false, est: null, note: '' };
  const fmtBytes = api.fmt.fmtBytes;

  /* ---------- stage ---------- */
  const cv = h('canvas.pt-gif__cv', { 'aria-label': t('Preview of the GIF'), role: 'img' });
  const empty = h('div.pt__empty', icon('film'), h('b', { text: t('Pick pictures or a video') }),
    h('small', { text: t('Choose on the right. The preview plays the frames the way the GIF will, and nothing is saved until you press Make GIF.') }));
  const paper = h('div.pt-gif__paper', { hidden: true }, cv);
  const result = h('div.pt-gif__result', { hidden: true });
  const foot = h('div.pt__foot', { role: 'status', 'aria-live': 'polite' });
  const prog = h('progress.pt-conv__progress', { max: 1, value: 0, hidden: true, 'aria-label': t('Progress') });
  const main = h('div.pt__col', h('div.pt__stage.pt-gif__stage', empty, paper, result), h('div.pt-conv__progwrap', prog), foot);

  /* ---------- preview loop ---------- */
  function stopPlay() { clearTimeout(S.play); S.play = 0; }
  function playPreview() {
    stopPlay();
    if (!S.frames.length || !S.dim) return;
    const g = cv.getContext('2d');
    let i = 0;
    const step = () => {
      if (!S.alive || !S.frames.length) return;
      const f = S.frames[i % S.frames.length];
      g.putImageData(new ImageData(f.data, S.dim.w, S.dim.h), 0, 0);
      i++;
      S.play = setTimeout(step, Math.max(20, f.delay));
    };
    step();
  }

  /* ---------- frames ---------- */
  const sources = () => picker.selected();
  function drawCover(g, bmp, W, H) {
    const { w, h: hh } = sizeOfBitmap(bmp);
    const k = Math.max(W / w, H / hh);
    g.drawImage(bmp, (W - w * k) / 2, (H - hh * k) / 2, w * k, hh * k);
  }
  async function picturesFrames(seq) {
    const list = sources();
    if (!list.length) return null;
    const frames = [];
    let W = 0, H = 0, c, g;
    for (let i = 0; i < list.length && i < MAX_FRAMES; i++) {
      const bmp = await bitmapOf(await blobOfSource(list[i]));
      if (seq !== S.seq) return null;
      if (!c) {
        const { w, h: hh } = sizeOfBitmap(bmp);
        W = Math.max(1, Math.min(O.width, w)); H = Math.max(1, Math.round(hh * W / w));
        W = Math.min(W, MAX_W);
        c = document.createElement('canvas'); c.width = W; c.height = H;
        g = c.getContext('2d', { willReadFrequently: true });
      }
      g.clearRect(0, 0, W, H);
      drawCover(g, bmp, W, H);
      bmp.close?.();
      frames.push({ data: g.getImageData(0, 0, W, H).data, delay: O.delay });
      prog.value = (i + 1) / list.length;
      await tick();
    }
    return { frames, w: W, h: H, capped: list.length > MAX_FRAMES };
  }
  async function videoFrames(seq) {
    if (!S.video) return null;
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.style.cssText = 'position:fixed;left:-10000px;top:0;width:320px;height:180px;opacity:0;pointer-events:none';
    document.body.appendChild(v);
    try {
      v.src = S.vurl;
      await once(v, 'loadedmetadata', 15000);
      if (!v.videoWidth) throw new Error('There’s no picture in this video.');
      const W = Math.max(1, Math.min(O.width, v.videoWidth, MAX_W)), H = Math.max(1, Math.round(v.videoHeight * W / v.videoWidth));
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const g = c.getContext('2d', { willReadFrequently: true });
      const a = Math.max(0, O.start), b = Math.max(a + 0.05, O.end);
      const total = Math.max(1, Math.round((b - a) * O.fps));
      const n = Math.min(total, MAX_FRAMES);
      const frames = [];
      for (let i = 0; i < n; i++) {
        const t = a + i / O.fps;
        const sk = once(v, 'seeked', 8000);
        v.currentTime = t;
        await sk;
        if (seq !== S.seq) return null;
        g.drawImage(v, 0, 0, W, H);
        frames.push({ data: g.getImageData(0, 0, W, H).data, delay: 1000 / O.fps });
        prog.value = (i + 1) / n;
        await tick();
      }
      return { frames, w: W, h: H, capped: total > MAX_FRAMES };
    } finally { v.removeAttribute('src'); v.load(); v.remove(); }
  }

  function schedule() {
    clearTimeout(S.timer);
    S.est = null;
    paintInfo();
    S.timer = setTimeout(rebuild, 320);
  }
  async function rebuild() {
    const seq = ++S.seq;
    stopPlay();
    S.frames = []; S.dim = null; S.note = ''; S.base = null;
    makeBtn.disabled = true;
    const want = O.mode === 'pictures' ? sources().length : (S.video ? 1 : 0);
    empty.hidden = want > 0;
    paper.hidden = !want;
    if (!want) { prog.hidden = true; paintInfo(); return; }
    prog.hidden = false; prog.value = 0;
    foot.textContent = O.mode === 'video' ? 'Reading frames from the video…' : 'Reading the pictures…';
    let r = null;
    try { r = await (O.mode === 'pictures' ? picturesFrames(seq) : videoFrames(seq)); }
    catch (err) { if (seq === S.seq && S.alive) { prog.hidden = true; S.note = `Couldn’t read the frames: ${err?.message || err}`; paintInfo(); } return; }
    if (!S.alive || seq !== S.seq || !r) return;
    prog.hidden = true;
    S.base = { frames: r.frames, w: r.w, h: r.h };
    S.note = r.capped ? `Only the first ${MAX_FRAMES} frames are used. Lower the frames per second or shorten the clip.` : '';
    await applyFx(seq);
  }

  /* ---------- captions, boomerang and speed: made from the frames already read ---------- */
  function fitLine(g, text, W) {
    let px = Math.round(W * 0.12);
    g.font = `${px}px ${MEME_FONT}`;
    while (g.measureText(text).width > W * 0.94 && px > 8) { px -= 2; g.font = `${px}px ${MEME_FONT}`; }
    return px;
  }
  function captioned(frames, W, H) {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round'; g.miterLimit = 2;
    const lines = [[O.top.trim().toUpperCase(), 0.11], [O.bottom.trim().toUpperCase(), 0.89]].filter(l => l[0]);
    const out = frames.map(f => {
      g.putImageData(new ImageData(f.data, W, H), 0, 0);
      for (const [text, y] of lines) {
        const px = fitLine(g, text, W);
        g.lineWidth = Math.max(2, px * 0.14); g.strokeStyle = '#000'; g.fillStyle = '#fff';
        g.strokeText(text, W / 2, H * y); g.fillText(text, W / 2, H * y);
      }
      return { data: g.getImageData(0, 0, W, H).data, delay: f.delay };
    });
    c.width = c.height = 0;
    return out;
  }
  async function applyFx(seq = S.seq) {
    if (!S.base) return;
    clearTimeout(S.fxTimer);
    stopPlay();
    const { w, h: hh } = S.base;
    let frames = S.base.frames.map(f => ({ data: f.data, delay: f.delay }));
    if (O.top.trim() || O.bottom.trim()) {
      try { await document.fonts.load(`100px ${MEME_FONT}`); } catch (e) { /* the fallbacks draw */ }
      if (!S.alive || seq !== S.seq) return;
      frames = captioned(frames, w, hh);
    }
    frames = boomerangOf(frames, O.boomerang);
    frames = frames.map(f => ({ data: f.data, delay: Math.max(20, Math.round(f.delay / O.speed)) }));
    if (!S.alive || seq !== S.seq) return;
    S.frames = frames; S.dim = { w, h: hh };
    cv.width = w; cv.height = hh;
    playPreview();
    await tick();
    estimate(seq);
    paintInfo();
    makeBtn.disabled = false;
  }
  function scheduleFx() {
    if (!S.base) return;
    clearTimeout(S.fxTimer);
    S.est = null;
    S.fxTimer = setTimeout(() => applyFx(), 160);
  }
  const encOpts = () => ({ width: S.dim.w, height: S.dim.h, frames: S.frames, loop: true, colors: O.colors, dither: O.dither, optimize: O.optimize });
  function estimate(seq) {
    try { S.est = estimateGifSize(encOpts()); } catch (e) { S.est = null; }
    if (seq === S.seq) paintInfo();
  }
  function paintInfo() {
    if (!S.frames.length || !S.dim) { foot.textContent = S.note || ''; return; }
    const ms = S.frames.reduce((a, f) => a + f.delay, 0);
    const n = S.frames.length;
    foot.textContent = `${n} frame${n === 1 ? '' : 's'} · ${S.dim.w}×${S.dim.h} · ${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s · ${S.est ? `about ${fmtBytes(S.est)}` : 'estimating…'} · loops forever${S.note ? ` · ${S.note}` : ''}`;
  }

  /* ---------- make ---------- */
  async function make() {
    if (S.busy || !S.frames.length) return;
    S.busy = true; makeBtn.disabled = true;
    prog.hidden = false; prog.value = 0; prog.removeAttribute('value');
    foot.textContent = 'Writing the GIF…';
    await tick(); await tick();
    try {
      const bytes = encodeGif(encOpts());
      const blob = new Blob([bytes], { type: 'image/gif' });
      const first = sources()[0];
      const base = O.mode === 'video' ? stemOf(S.video?.name || 'clip') : (first ? stemOf(first.name) : 'animation');
      const path = await saveBlob(api, 'Picture Tools', picturesDir(), `${base}.gif`, blob, { title: t('GIF saved') });
      if (!S.alive) return;
      S.est = blob.size;
      lastPath = path;
      showResult(blob, path);
      foot.textContent = `Saved ${vfs.baseName(path)} — ${S.frames.length} frames, ${fmtBytes(blob.size)}`;
    } catch (err) {
      foot.textContent = `The GIF couldn’t be made: ${err?.message || err}`;
    } finally { S.busy = false; prog.hidden = true; if (S.alive) makeBtn.disabled = !S.frames.length; }
  }
  let lastPath = '', resultUrl = '';
  function showResult(blob, path) {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = URL.createObjectURL(blob);
    result.hidden = false;
    result.dataset.path = path;
    result.replaceChildren(h('img', { src: resultUrl, alt: t('The saved GIF'), draggable: 'false' }),
      h('small', { text: `Saved as ${vfs.baseName(path)} in ~/Pictures · ${fmtBytes(blob.size)}` }),
      h('div.pt__actions', h('button.btn.btn--sm', { type: 'button', onclick: () => api.openApp('photos', { path }) }, icon('image'), h('span', { text: t('Open in Photos') })),
        h('button.btn.btn--sm', { type: 'button', onclick: () => api.openApp('drop', { send: [path] }) }, icon('send'), h('span', { text: t('Send with Drop') }))));
  }

  /* ---------- options ---------- */
  const seg = (name, list, get, set) => {
    const btns = list.map(([id, label]) => h('button.pt__segbtn', { type: 'button', role: 'radio', 'aria-checked': String(get() === id), dataset: { v: id },
      onclick: () => { set(id); for (const b of btns) b.setAttribute('aria-checked', String(b.dataset.v === get())); } }, label));
    return h('div.pt__seg', { role: 'radiogroup', 'aria-label': name }, btns);
  };
  const num = (label, key, min, max, step, onset, soft) => {
    const input = h('input', { type: 'number', min, max, step, value: String(O[key]), 'aria-label': label,
      oninput: () => { const v = Number(input.value); if (!Number.isFinite(v)) return; O[key] = clamp(v, min, max); onset?.(); (soft ? scheduleFx : schedule)(); } });
    return { input, row: h('label.pt__line', h('span', { text: label }), input) };
  };

  const picker = pickerView(api, { multi: true, label: t('Pictures for the GIF'), onChange: () => { if (O.mode === 'pictures') schedule(); } });
  const delay = num('Delay (ms)', 'delay', 20, 5000, 10, () => { if (S.base) for (const f of S.base.frames) f.delay = O.delay; }, true);
  const picGroup = h('div.pt__group', picker.el, delay.row,
    h('small.pt__hint', { text: t('One frame per picture, in the order you picked them (the badge shows the order).') }));

  const vids = listVideos();
  const vlist = h('div.pt-gif__vids', { role: 'listbox', 'aria-label': t('Videos') },
    vids.length ? vids.map(v => h('button.pt-gif__vid', { type: 'button', role: 'option', 'aria-selected': 'false', dataset: { name: v.name }, onclick: () => chooseVideo(v) },
      icon('film'), h('span', { text: v.name }))) : h('small.pt__hint', { text: t('No videos in ~/Videos yet. Record the screen with Recorder, or use “From computer…”.') }));
  const vfile = h('input', { type: 'file', accept: 'video/*', hidden: true, 'aria-label': t('Choose a video from this computer'),
    onchange: () => { const f = vfile.files?.[0]; vfile.value = ''; if (f) chooseVideo({ key: `file:${f.name}`, name: f.name, file: f }); } });
  const start = num('Start (s)', 'start', 0, 36000, 0.1);
  const end = num('End (s)', 'end', 0.1, 36000, 0.1);
  const fps = num('Frames/s', 'fps', 1, 30, 1);
  const vidInfo = h('small.pt__hint', { text: t('Choose a video.') });
  const vidGroup = h('div.pt__group', { hidden: true }, vlist,
    h('button.btn.btn--sm', { type: 'button', onclick: () => vfile.click() }, icon('upload'), h('span', { text: t('From computer…') })), vfile,
    start.row, end.row, fps.row, vidInfo);

  async function chooseVideo(v) {
    for (const b of vlist.querySelectorAll('.pt-gif__vid')) b.setAttribute('aria-selected', String(b.dataset.name === v.name));
    if (S.vurl && S.video?.file) URL.revokeObjectURL(S.vurl);
    S.video = v; S.vurl = null; S.vdur = 0;
    vidInfo.textContent = 'Reading the video…';
    try {
      S.vurl = v.file ? URL.createObjectURL(v.file) : await media.urlOf(v.path);
      if (!S.vurl) throw new Error('its bytes are missing from this browser');
      const el = document.createElement('video');
      el.muted = true; el.preload = 'metadata'; el.style.cssText = 'position:fixed;left:-10000px;width:2px;height:2px;opacity:0';
      document.body.appendChild(el);
      try {
        el.src = S.vurl;
        await once(el, 'loadedmetadata', 15000);
        if (!Number.isFinite(el.duration)) {            /* a fresh recording has no length in its header: seek past the end to learn it */
          const got = once(el, 'durationchange', 6000).catch(() => {});
          el.currentTime = 1e101; await got;
        }
        S.vdur = Number.isFinite(el.duration) ? el.duration : 0;
      } finally { el.removeAttribute('src'); el.load(); el.remove(); }
      if (!S.alive) return;
      O.start = 0; O.end = S.vdur ? Math.round(Math.min(S.vdur, 5) * 10) / 10 : 5;
      start.input.value = String(O.start); end.input.value = String(O.end);
      vidInfo.textContent = `${v.name} · ${S.vdur ? `${S.vdur.toFixed(1)} s long` : 'length unknown'}`;
      schedule();
    } catch (err) {
      S.video = null;
      vidInfo.textContent = `Can’t use this video: ${err?.message || err}`;
    }
  }

  const modeSeg = seg('Make it from', [['pictures', 'Pictures'], ['video', 'Video']], () => O.mode, id => {
    O.mode = id; picGroup.hidden = id !== 'pictures'; vidGroup.hidden = id !== 'video'; schedule();
  });
  const wSel = h('select', { 'aria-label': t('Width'), onchange: () => { O.width = Number(wSel.value); schedule(); } },
    [160, 240, 320, 480, 640].map(w => h('option', { value: String(w), text: t('{w} px wide', { w }), selected: w === O.width })));
  const colorsSel = h('select', { 'aria-label': t('Colours'), onchange: () => { O.colors = Number(colorsSel.value); schedule(); } },
    [[256, '256 colours (best)'], [128, '128 colours'], [64, '64 colours'], [32, '32 colours (smallest)']].map(([n, l]) => h('option', { value: String(n), text: l })));
  const ditherBox = h('input', { type: 'checkbox', 'aria-label': t('Dithering'), onchange: () => { O.dither = ditherBox.checked; schedule(); } });
  const optBox = h('input', { type: 'checkbox', checked: true, 'aria-label': t('Only store what changes between frames'), onchange: () => { O.optimize = optBox.checked; schedule(); } });
  /* captions, boomerang, speed */
  const topIn = h('input', { type: 'text', maxlength: 60, placeholder: t('Top caption'), 'aria-label': t('Top caption'), dataset: { fk: 'gif-top' }, oninput: () => { O.top = topIn.value; scheduleFx(); } });
  const botIn = h('input', { type: 'text', maxlength: 60, placeholder: t('Bottom caption'), 'aria-label': t('Bottom caption'), dataset: { fk: 'gif-bottom' }, oninput: () => { O.bottom = botIn.value; scheduleFx(); } });
  const boomBox = h('input', { type: 'checkbox', 'aria-label': t('Boomerang'), dataset: { fk: 'gif-boomerang' }, onchange: () => { O.boomerang = boomBox.checked; scheduleFx(); } });
  const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4];
  const speedSel = h('select', { 'aria-label': t('Speed'), dataset: { fk: 'gif-speed' }, onchange: () => { O.speed = Number(speedSel.value); scheduleFx(); } },
    SPEEDS.map(v => h('option', { value: String(v), text: v === 1 ? t('Normal speed') : `${v}× ${v < 1 ? 'slower' : 'faster'}`, selected: v === 1 })));
  const makeBtn = h('button.btn.btn--primary', { type: 'button', disabled: true, onclick: () => make() }, icon('film'), h('span', { text: t('Make GIF') }));
  const side = h('div.pt__side',
    modeSeg, picGroup, vidGroup,
    h('div.pt__group', h('b.pt__label', { text: t('Captions and motion') }),
      h('label.pt__line', h('span', { text: t('Top') }), topIn), h('label.pt__line', h('span', { text: t('Bottom') }), botIn),
      h('label.pt__check', boomBox, h('span', { text: t('Boomerang (plays forwards, then backwards)') })), speedSel),
    h('div.pt__group', h('b.pt__label', { text: t('Size and quality') }), wSel, colorsSel,
      h('label.pt__check', ditherBox, h('span', { text: t('Dithering (smoother gradients, bigger file)') })),
      h('label.pt__check', optBox, h('span', { text: t('Only store what changes between frames (smaller file)') }))),
    h('div.pt__actions', makeBtn),
    h('small.pt__hint', { text: t('The GIF repeats forever and is saved in ~/Pictures. The size shown is an estimate until you make it.') }));
  root.append(h('div.pt__split', main, side));
  paintInfo();

  /* opened with a path: a picture starts a pictures GIF, a video starts a video one */
  const p = opts?.path;
  if (p && media.kindOf(p) === 'video' && vfs.node(p)) {
    modeSeg.querySelector('[data-v="video"]').click();
    chooseVideo({ key: p, name: vfs.baseName(p), path: p });
  } else if (p) { const s = sourceOfPath(p); if (s) picker.pick(s); }
  if (Array.isArray(opts?.paths)) for (const q of opts.paths) { const s = sourceOfPath(q); if (s) picker.pick(s); }

  return () => {
    S.alive = false;
    S.seq++;
    clearTimeout(S.timer); clearTimeout(S.fxTimer); stopPlay();
    picker.destroy();
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    if (S.vurl && S.video?.file) URL.revokeObjectURL(S.vurl);
    S.frames = [];
  };
}
