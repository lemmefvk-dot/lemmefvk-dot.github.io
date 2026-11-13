/* ============================================================
   trimmer.js — the video trimmer (#120), opened from Videos.

   openTrimmer({ api, host, path, onOpenFile, onClose }) puts a panel over
   `host` (the Videos window) for one video file:

   · a timeline with a picture strip, an In handle, an Out handle and a
     playhead. Drag a handle, click the strip to move the playhead, or focus
     a handle and use the arrow keys (one frame; Shift = one second).
   · frame-accurate nudging: −1 / +1 frame buttons for In, Out and the
     playhead, and "Set In / Set Out here". A video file doesn't say how
     many frames per second it has to a web page, so the frame rate is a
     choice (24, 25, 30 or 60); a frame is 1 / that many seconds.
   · Preview plays from In and stops at Out.
   · Save makes a NEW file beside the original, "<name> (trimmed).webm",
     re-encoded the same way Recorder cuts a screen recording
     (js/core/videocut.js exportCut: the part between In and Out is played
     once, out of sight, into a canvas + MediaRecorder; sound is kept).
     The original is only replaced if "Replace the original" is ticked and
     confirmed; then the file is swapped for the trimmed WebM.

   Why WebM: a web page can only write video through MediaRecorder, and
   MediaRecorder writes WebM everywhere; MP4 (H.264/AAC) needs an encoder
   that browsers don't offer to pages in a portable way. The trimmed copy
   is re-encoded, so it is a little different in quality and size from a
   straight copy, and it takes as long as the trimmed part lasts.
   ============================================================ */
import * as VC from '../core/videocut.js';
import * as media from '../core/media.js';
import vfs from '../core/vfs.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-pictools-css')) {
  const l = document.createElement('link');
  l.id = 'feat-pictools-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-pictools.css';
  document.head.appendChild(l);
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const stemOf = n => { const i = String(n).lastIndexOf('.'); return i > 0 ? String(n).slice(0, i) : String(n); };
export function stamp(t) {
  t = Math.max(0, Number(t) || 0);
  const ms = Math.round(t * 1000);
  const m = Math.floor(ms / 60000), s = Math.floor(ms / 1000) % 60, r = ms % 1000;
  return `${m}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}`;
}

export function openTrimmer({ api, host, path, onOpenFile, onClose }) {
  const { h, icon } = api;
  const node = vfs.node(path);
  const T = { alive: true, dur: 0, a: 0, b: 0, at: 0, fps: 30, url: '', ctl: null, strip: null, previewing: false, drag: null, raf: 0 };
  const fmtBytes = api.fmt.fmtBytes;

  const video = h('video.vtrim__video', { playsinline: '', preload: 'auto', muted: true, 'aria-label': 'Video being trimmed' });
  video.muted = true;
  const view = h('div.vtrim__view', video);
  const strip = h('canvas.vtrim__strip', { 'aria-hidden': 'true' });
  const dimL = h('div.vtrim__dim'), dimR = h('div.vtrim__dim');
  const sel = h('div.vtrim__sel');
  const head = h('div.vtrim__head-at');
  const mkHandle = (which, label) => h('div.vtrim__handle', {
    role: 'slider', tabindex: '0', 'aria-label': label, dataset: { handle: which },
    onkeydown: e => {
      const step = e.shiftKey ? 1 : 1 / T.fps;
      const d = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : 0;
      if (!d) return;
      e.preventDefault(); e.stopPropagation();
      nudge(which, d * step);
    },
  }, which === 'a' ? '[' : ']');
  const hA = mkHandle('a', 'In point'), hB = mkHandle('b', 'Out point');
  const tl = h('div.vtrim__tl', { role: 'group', 'aria-label': 'Timeline' }, strip, dimL, dimR, sel, head, hA, hB);

  const inF = h('input', { type: 'text', 'aria-label': 'In point (m:ss.mmm)', spellcheck: 'false', onchange: () => setFrom(inF, 'a') });
  const outF = h('input', { type: 'text', 'aria-label': 'Out point (m:ss.mmm)', spellcheck: 'false', onchange: () => setFrom(outF, 'b') });
  const lenOut = h('output.mono', { 'aria-label': 'Length of the trimmed video' });
  const atOut = h('output.mono', { 'aria-label': 'Playhead' });
  const fpsSel = h('select', { 'aria-label': 'Frames per second of this video', onchange: () => { T.fps = Number(fpsSel.value); } },
    [24, 25, 30, 60].map(n => h('option', { value: String(n), text: `${n} fps`, selected: n === 30 })));
  const btn = (label, aria, fn, cls = '') => h(`button.btn.btn--sm${cls}`, { type: 'button', 'aria-label': aria, onclick: fn }, h('span', { text: label }));
  const status = h('div.vtrim__status', { role: 'status', 'aria-live': 'polite' });
  const prog = h('progress.pt-conv__progress', { max: 1, value: 0, hidden: true, 'aria-label': 'Saving progress' });
  const replaceBox = h('input', { type: 'checkbox', 'aria-label': 'Replace the original file instead of saving a copy' });
  const saveBtn = h('button.btn.btn--primary', { type: 'button', disabled: true, onclick: () => save() }, icon('crop'), h('span', { text: 'Save trimmed copy' }));
  const cancelBtn = h('button.btn', { type: 'button', hidden: true, onclick: () => T.ctl?.abort() }, h('span', { text: 'Cancel' }));
  const prevBtn = h('button.btn.btn--sm', { type: 'button', 'aria-label': 'Preview the trimmed part', disabled: true, onclick: () => preview() }, icon('play'), h('span', { text: 'Preview' }));
  const closeBtn = h('button.ibtn', { type: 'button', 'aria-label': 'Close the trimmer', onclick: () => close() }, icon('x'));

  const panel = h('div.vtrim', { role: 'dialog', 'aria-label': `Trim ${node?.name || 'video'}`, dataset: { path } },
    h('div.vtrim__head', icon('crop'), h('b', { text: `Trim — ${node?.name || ''}` }), closeBtn),
    view, tl,
    h('div.vtrim__row',
      h('label', h('span', { text: 'In' }), inF), btn('−1 frame', 'In point back one frame', () => nudge('a', -1 / T.fps)), btn('+1 frame', 'In point forward one frame', () => nudge('a', 1 / T.fps)),
      btn('Set In here', 'Set the In point to the playhead', () => setPoint('a', video.currentTime || 0))),
    h('div.vtrim__row',
      h('label', h('span', { text: 'Out' }), outF), btn('−1 frame', 'Out point back one frame', () => nudge('b', -1 / T.fps)), btn('+1 frame', 'Out point forward one frame', () => nudge('b', 1 / T.fps)),
      btn('Set Out here', 'Set the Out point to the playhead', () => setPoint('b', video.currentTime || 0))),
    h('div.vtrim__row',
      prevBtn, btn('◀ frame', 'Playhead back one frame', () => seekTo((video.currentTime || 0) - 1 / T.fps)), btn('frame ▶', 'Playhead forward one frame', () => seekTo((video.currentTime || 0) + 1 / T.fps)),
      h('label', h('span', { text: 'Frame rate' }), fpsSel),
      h('span', { text: 'Playhead ' }), atOut, h('span', { text: ' · Length ' }), lenOut),
    h('div.vtrim__row', h('label', replaceBox, h('span', { text: 'Replace the original (asks first)' })), h('span.grow'), cancelBtn, saveBtn),
    prog, status,
    h('div.vtrim__note', { text: 'The trimmed video is saved as WebM. A web page can only write video through the browser’s recorder, and browsers write WebM everywhere but can’t write MP4 in a portable way. WebM plays in every current browser and phone. The trimmed part is re-encoded as it plays, so saving takes as long as the clip, and sound is kept. Your original is not changed unless you tick Replace.' }));
  host.appendChild(panel);

  /* ---------- timeline ---------- */
  const pct = t => (T.dur ? clamp(t / T.dur, 0, 1) * 100 : 0);
  function paint() {
    hA.style.left = `${pct(T.a)}%`; hB.style.left = `${pct(T.b)}%`;
    dimL.style.cssText = `left:0;width:${pct(T.a)}%`;
    dimR.style.cssText = `left:${pct(T.b)}%;right:0`;
    sel.style.cssText = `left:${pct(T.a)}%;width:${pct(T.b) - pct(T.a)}%`;
    head.style.left = `${pct(T.at)}%`;
    hA.setAttribute('aria-valuetext', stamp(T.a)); hB.setAttribute('aria-valuetext', stamp(T.b));
    hA.setAttribute('aria-valuenow', String(T.a)); hB.setAttribute('aria-valuenow', String(T.b));
    if (document.activeElement !== inF) inF.value = stamp(T.a);
    if (document.activeElement !== outF) outF.value = stamp(T.b);
    lenOut.textContent = stamp(Math.max(0, T.b - T.a));
    atOut.textContent = stamp(T.at);
    panel.dataset.a = T.a.toFixed(3); panel.dataset.b = T.b.toFixed(3);
    saveBtn.disabled = !T.dur || T.b - T.a < 0.1 || !!T.ctl || !VC.canCut();
    prevBtn.disabled = !T.dur || T.b - T.a < 0.1 || !!T.ctl;
  }
  const snap = t => Math.round(t * T.fps) / T.fps;
  function seekTo(t) {
    stopPreview();
    video.currentTime = clamp(t, 0, T.dur || 0);
    T.at = video.currentTime; paint();
  }
  function setPoint(which, t) {
    t = clamp(snap(t), 0, T.dur);
    if (which === 'a') T.a = Math.min(t, T.b - 1 / T.fps); else T.b = Math.max(t, T.a + 1 / T.fps);
    T.a = clamp(T.a, 0, T.dur); T.b = clamp(T.b, 0, T.dur);
    status.textContent = ''; status.classList.remove('is-err');
    seekTo(which === 'a' ? T.a : T.b);
  }
  const nudge = (which, d) => setPoint(which, (which === 'a' ? T.a : T.b) + d);
  function setFrom(input, which) {
    const t = VC.parseClock(input.value);
    if (Number.isNaN(t)) { status.textContent = 'Type a time like 0:03.250 or 3.25.'; status.classList.add('is-err'); input.value = stamp(which === 'a' ? T.a : T.b); return; }
    setPoint(which, t);
  }
  /* pointer: drag a handle, or click the strip to move the playhead */
  const timeAt = e => { const r = tl.getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width, 0, 1) * T.dur; };
  tl.addEventListener('pointerdown', e => {
    if (!T.dur) return;
    const hd = e.target.closest?.('.vtrim__handle');
    T.drag = hd ? hd.dataset.handle : 'playhead';
    tl.setPointerCapture?.(e.pointerId);
    if (T.drag === 'playhead') seekTo(timeAt(e));
    else hd.focus();
    e.preventDefault();
  });
  tl.addEventListener('pointermove', e => {
    if (!T.drag) return;
    if (T.drag === 'playhead') seekTo(timeAt(e)); else setPoint(T.drag, timeAt(e));
  });
  const endDrag = () => { T.drag = null; };
  tl.addEventListener('pointerup', endDrag); tl.addEventListener('pointercancel', endDrag);

  /* ---------- preview ---------- */
  function stopPreview() {
    T.previewing = false;
    cancelAnimationFrame(T.raf);
    try { video.pause(); } catch (e) { /* idle */ }
    prevBtn.querySelector('span').textContent = 'Preview';
  }
  async function preview() {
    if (T.previewing) { stopPreview(); return; }
    video.currentTime = T.a; T.at = T.a;
    await new Promise(r => { const t = setTimeout(r, 1500); video.addEventListener('seeked', () => { clearTimeout(t); r(); }, { once: true }); });
    if (!T.alive) return;
    T.previewing = true;
    prevBtn.querySelector('span').textContent = 'Stop';
    try { await video.play(); } catch (e) { status.textContent = 'The browser wouldn’t play the preview.'; stopPreview(); return; }
    const loop = () => {
      if (!T.previewing || !T.alive) return;
      T.at = video.currentTime;
      if (T.at >= T.b - 0.5 / T.fps || video.ended) { stopPreview(); video.currentTime = T.b; T.at = T.b; paint(); return; }
      paint();
      T.raf = requestAnimationFrame(loop);
    };
    loop();
  }
  video.addEventListener('timeupdate', () => { if (!T.previewing && !T.drag) { T.at = video.currentTime; paint(); } });

  /* ---------- save ---------- */
  async function save() {
    if (T.ctl || !T.dur) return;
    const replace = replaceBox.checked;
    if (replace) {
      const okay = await api.confirm({ title: `Replace “${node.name}”?`, message: 'The original video is overwritten with the trimmed WebM (its name will end in .webm). This can’t be undone.', ok: 'Replace original', danger: true });
      if (!okay || !T.alive) return;
    }
    stopPreview();
    const ctl = new AbortController();
    T.ctl = ctl;
    cancelBtn.hidden = false; prog.hidden = false; prog.value = 0;
    status.classList.remove('is-err');
    status.textContent = `Saving ${stamp(T.b - T.a)} — the trimmed part plays through once, out of sight, while it is re-encoded. Keep this tab open.`;
    paint();
    let res = null;
    try {
      res = await VC.exportCut({ url: T.url, a: T.a, b: T.b, signal: ctl.signal, onProgress: f => { prog.value = f; } });
    } catch (err) {
      if (!T.alive) return;
      status.textContent = err.code === 'abort' ? 'Cancelled. Nothing was saved.' : `The trim didn’t finish: ${err.message || err}`;
      if (err.code !== 'abort') status.classList.add('is-err');
      finish();
      return;
    }
    if (!T.alive) return;
    try {
      let saved;
      if (replace && vfs.node(path)) saved = await media.replace(path, res.blob, { name: `${stemOf(node.name)}.webm` });
      else {
        const dir = vfs.node(vfs.parentPath(path)) ? vfs.parentPath(path) : `${vfs.HOME}/Videos`;
        saved = await media.save(dir, `${stemOf(node.name)} (trimmed).webm`, res.blob);
      }
      if (saved.node && saved.node.kind !== 'video') { saved.node.kind = 'video'; api.bus.emit('fs:change', vfs.parentPath(saved.path), saved.path); }
      panel.dataset.saved = saved.path;
      status.textContent = replace
        ? `Replaced the original with ${vfs.baseName(saved.path)} — ${stamp(res.ms / 1000)}, ${fmtBytes(res.blob.size)}.`
        : `Saved ${vfs.baseName(saved.path)} — ${stamp(res.ms / 1000)}, ${fmtBytes(res.blob.size)}, beside the original. “${node.name}” is unchanged.`;
      api.notify({ app: 'Videos', icon: 'film', title: 'Trimmed video saved', message: `${vfs.baseName(saved.path)} · ${fmtBytes(res.blob.size)}`,
        actions: [{ label: 'Play', onClick: () => onOpenFile?.(saved.path) }] });
    } catch (err) {
      status.textContent = `The trimmed video couldn’t be saved: ${err?.message || err}`;
      status.classList.add('is-err');
    }
    finish();
  }
  function finish() { T.ctl = null; cancelBtn.hidden = true; prog.hidden = true; paint(); }

  /* ---------- open ---------- */
  function close() {
    if (!T.alive) return;
    T.alive = false;
    T.ctl?.abort();
    stopPreview();
    video.removeAttribute('src'); video.load();
    panel.remove();
    onClose?.();
  }
  (async () => {
    try {
      T.url = await media.urlOf(path);
      if (!T.url) throw new Error('its bytes are missing from this browser');
      video.src = T.url;
      const info = await VC.probe(T.url);
      if (!T.alive) return;
      if (!(info.dur > 0)) throw new Error('its length can’t be read');
      T.dur = info.dur; T.a = 0; T.b = snap(info.dur) > info.dur ? info.dur : snap(info.dur);
      T.b = Math.min(T.b, info.dur);
      status.textContent = `${info.w}×${info.h} · ${stamp(info.dur)} long`;
      paint();
      const w = Math.max(200, tl.clientWidth || 600);
      VC.filmstrip(T.url, info.dur, Math.min(24, Math.max(4, Math.round(w / 56))), 56).then(c => {
        if (!T.alive || !c) return;
        strip.width = c.width; strip.height = c.height;
        strip.getContext('2d').drawImage(c, 0, 0);
      }).catch(() => {});
    } catch (err) {
      if (!T.alive) return;
      status.textContent = `This video can’t be trimmed: ${err?.message || err}`;
      status.classList.add('is-err');
    }
  })();
  panel.addEventListener('keydown', e => { if (e.key === 'Escape' && !T.ctl) { e.stopPropagation(); close(); } });
  paint();
  hA.focus({ preventScroll: true });
  return { close, el: panel };
}
