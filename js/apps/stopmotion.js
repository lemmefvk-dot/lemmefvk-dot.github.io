/* ============================================================
   stopmotion.js — Stop motion with your camera.

   The camera starts only when you press "Start camera" (the browser asks
   then, not before), and stops when you press Stop camera or close the
   window. Move your things a little, press Take picture (Space), and the
   picture joins the strip below. The last picture shows faintly over the
   live view — the onion skin — so you can see how far you moved things; the
   slider sets how faintly (and Onion skin turns it off).

   Click a picture in the strip to look at it (Delete removes it; Live goes
   back to the camera). Play runs the pictures at 1–24 a second. Save writes
   the animation into your Files: a GIF in ~/Pictures/Stop motion (js/core/
   gif.js) or a WebM in ~/Videos, played into MediaRecorder in real time.
   Pictures are kept in memory while the window is open; save to keep them.

   Keys: Space take a picture   O onion skin   P play / stop   L live
         , and . look at the previous / next picture   Delete remove the one shown
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { encodeGif } from '../core/gif.js';
import { openCamera, cameraProblem, stopStream } from '../core/scancam.js';
import { saveBlob } from '../photos/pt-common.js';
import { makerCss, frameData, recordCanvases, clamp } from '../core/makerkit.js';

makerCss();
const MAX_FRAMES = 100;
const MAX_W = 640;

defineApp({
  id: 'stopmotion',
  name: 'Stop motion',
  icon: 'video',
  g1: '#ffd36b', g2: '#ef7d57',
  category: 'Create',
  keywords: ['stop motion', 'stop-motion', 'animation', 'claymation', 'lego', 'camera', 'frames', 'onion skin', 'time lapse', 'gif', 'film'],
  desc: 'Make a stop-motion film with your camera, with an onion skin',
  singleton: true,
  win: { w: 900, h: 660, minW: 600, minH: 480 },
  shortcuts: [['Space', 'Take a picture'], ['O', 'Onion skin on / off'], ['P', 'Play / stop'], ['L', 'Back to the live view'], [', / .', 'Previous / next picture'], ['Delete', 'Remove the picture shown']],

  mount(ctx) {
    const { root, win, api } = ctx;
    const { h, icon } = api;

    const S = { stream: null, frames: [], shown: -1, onion: true, opacity: 0.4, fps: 8, playing: 0, msg: '', busy: false, dead: false };
    let rec = null, size = null;

    const video = h('video.mk-sm__video', { autoplay: true, muted: true, playsinline: true, 'aria-label': 'Live camera' });
    video.muted = true;
    const ghost = h('canvas.mk-sm__ghost', { 'aria-hidden': 'true' });
    const still = h('canvas.mk-sm__still', { 'aria-label': 'Picture shown', role: 'img', hidden: true });
    const empty = h('div.mk-sm__empty', h('p', { text: 'The camera is off.' }), h('small.mk-hint', { text: 'Press Start camera. Your browser will ask first. Nothing is recorded or sent anywhere; pictures stay in this window until you save them.' }));
    const msg = h('small.mk-msg', { role: 'status', 'aria-live': 'polite' });
    const stat = h('span.mk-stat');
    const say = t => { S.msg = t; msg.textContent = t; };

    /* ---------- the camera ---------- */
    async function start() {
      if (S.stream) return;
      startBtn.disabled = true; say('Asking for the camera…');
      try {
        const stream = await openCamera({ facing: 'user', width: 1280, height: 720 });
        if (S.dead) return stopStream(stream);
        S.stream = stream; video.srcObject = stream;
        try { await video.play(); } catch (e) { /* autoplay is on already */ }
        await new Promise(res => { if (video.videoWidth) res(); else video.addEventListener('loadedmetadata', res, { once: true }); });
        empty.hidden = true; say('Camera on. Press Space to take a picture.');
        live(); paintGhost(); btns(); takeBtn.focus();
      } catch (err) {
        const p = cameraProblem(err);
        say(`${p.title}. ${p.body}`);
        startBtn.disabled = false;
      }
    }
    function stopCam() {
      if (!S.stream) return;
      stopStream(S.stream); S.stream = null; video.srcObject = null;
      empty.hidden = false; ghost.hidden = true; say('Camera off.'); btns();
    }
    function frameSize() {
      if (size) return size;
      const vw = video.videoWidth || 640, vh = video.videoHeight || 360, k = Math.min(1, MAX_W / vw);
      return (size = { w: Math.round(vw * k), h: Math.round(vh * k) });
    }

    /* ---------- pictures ---------- */
    function take() {
      if (!S.stream) return say('Start the camera first.');
      if (S.busy) return;
      if (S.frames.length >= MAX_FRAMES) return say(`That is ${MAX_FRAMES} pictures, the most one film holds. Save it, then start again.`);
      stopPlay();
      const { w, h: ph } = frameSize();
      const c = document.createElement('canvas'); c.width = w; c.height = ph;
      c.getContext('2d', { willReadFrequently: true }).drawImage(video, 0, 0, w, ph);
      S.frames.push(c); live(); paintStrip(); paintGhost(); status(); btns();
      say(`Picture ${S.frames.length} taken.`);
    }
    function paintGhost() {
      const last = S.frames[S.frames.length - 1];
      ghost.hidden = !(S.onion && last && S.stream && S.shown < 0);
      if (!last) return;
      ghost.width = last.width; ghost.height = last.height;
      ghost.getContext('2d').drawImage(last, 0, 0);
      ghost.style.opacity = String(S.opacity);
    }
    function live() { S.shown = -1; still.hidden = true; video.hidden = false; markStrip(); paintGhost(); status(); }
    function look(i) {
      if (!S.frames.length) return;
      S.shown = clamp(i, 0, S.frames.length - 1);
      const f = S.frames[S.shown];
      still.width = f.width; still.height = f.height; still.getContext('2d').drawImage(f, 0, 0);
      still.hidden = false; video.hidden = true; ghost.hidden = true; markStrip(); status();
    }
    function remove() {
      if (S.shown < 0) {
        if (!S.frames.length) return;
        S.frames.pop(); say('Took off the last picture.');
      } else { S.frames.splice(S.shown, 1); say('Picture removed.'); }
      stopPlay();
      if (!S.frames.length) { size = size && S.stream ? size : null; live(); }
      else if (S.shown >= 0) look(Math.min(S.shown, S.frames.length - 1));
      paintStrip(); paintGhost(); status(); btns();
    }

    /* ---------- playing ---------- */
    function play() {
      if (S.playing) return stopPlay();
      if (S.frames.length < 2) return say('Take at least two pictures to play them.');
      let n = S.shown >= 0 && S.shown < S.frames.length - 1 ? S.shown : -1;
      const tick = () => { n = (n + 1) % S.frames.length; look(n); S.playing = setTimeout(tick, 1000 / S.fps); };
      tick();
      playBtn.replaceChildren(icon('pause'), h('span', { text: 'Stop' })); playBtn.setAttribute('aria-pressed', 'true');
    }
    function stopPlay() {
      if (!S.playing) return;
      clearTimeout(S.playing); S.playing = 0;
      playBtn.replaceChildren(icon('play'), h('span', { text: 'Play' })); playBtn.setAttribute('aria-pressed', 'false');
    }

    /* ---------- saving ---------- */
    async function saveGif() {
      if (S.busy || !S.frames.length) return;
      stopPlay(); S.busy = true; btns(); say('Writing the GIF…');
      try {
        await new Promise(r => setTimeout(r, 30));
        const { w, h: ph } = frameSize();
        const bytes = encodeGif({ width: w, height: ph, loop: true, frames: S.frames.map(c => ({ data: frameData(c), delay: Math.round(1000 / S.fps) })) });
        const blob = new Blob([bytes], { type: 'image/gif' });
        const path = await saveBlob(api, 'Stop motion', `${api.vfs.HOME}/Pictures/Stop motion`, 'Stop motion.gif', blob, { title: 'GIF saved', icon: 'video' });
        say(`Saved ${path.split('/').pop()} (${S.frames.length} pictures, ${S.fps} a second).`);
      } catch (err) { say('Couldn’t save the GIF: ' + err.message); }
      S.busy = false; btns();
    }
    async function saveVideo() {
      if (S.busy || !S.frames.length) return;
      stopPlay(); S.busy = true; btns(); say('Recording the video…');
      rec = recordCanvases(S.frames, S.fps, (i, n) => say(`Recording the video… picture ${i} of ${n}`));
      try {
        const blob = await rec.done;
        if (!S.dead) {
          if (!blob) say('This browser can’t make a video here. The GIF works everywhere.');
          else { const path = await saveBlob(api, 'Stop motion', `${api.vfs.HOME}/Videos`, 'Stop motion.webm', blob, { title: 'Video saved', icon: 'video' }); say(`Saved ${path.split('/').pop()}.`); }
        }
      } catch (err) { say('Couldn’t save the video: ' + err.message); }
      rec = null; S.busy = false; btns();
    }

    /* ---------- the window ---------- */
    const btn = (label, ic, fn, extra = {}) => h('button.btn.btn--sm', { type: 'button', onclick: fn, ...extra }, ic ? icon(ic) : null, h('span', { text: label }));
    const startBtn = btn('Start camera', 'camera', start, { class: 'btn--primary' });
    const stopBtn = btn('Stop camera', 'x', stopCam);
    const takeBtn = btn('Take picture', 'plus', take, { title: 'Take a picture (Space)' });
    const playBtn = btn('Play', 'play', play, { 'aria-pressed': 'false', title: 'Play (P)' });
    const liveBtn = btn('Live', 'eye', live, { title: 'Back to the camera (L)' });
    const delBtn = btn('Remove', 'trash', remove, { title: 'Remove the picture shown, or the last one (Delete)' });
    const gifBtn = btn('Save GIF', 'download', saveGif), vidBtn = btn('Save video', 'video', saveVideo);
    const onionBtn = btn('Onion skin', 'layers', () => { S.onion = !S.onion; onionBtn.setAttribute('aria-pressed', String(S.onion)); paintGhost(); }, { 'aria-pressed': 'true', title: 'Show the last picture faintly (O)' });
    const opIn = h('input', { type: 'range', min: '10', max: '80', value: '40', 'aria-label': 'Onion skin strength', oninput: e => { S.opacity = +e.target.value / 100; ghost.style.opacity = String(S.opacity); } });
    const fpsOut = h('output.mk-out', { text: '8 a second' });
    const fpsIn = h('input', { type: 'range', min: '1', max: '24', value: '8', 'aria-label': 'Pictures per second', oninput: e => { S.fps = +e.target.value; fpsOut.textContent = `${S.fps} a second`; } });
    function btns() {
      const on = !!S.stream, any = S.frames.length > 0;
      startBtn.hidden = on; stopBtn.hidden = !on; startBtn.disabled = false;
      takeBtn.disabled = !on || S.busy; liveBtn.disabled = !on; delBtn.disabled = !any;
      playBtn.disabled = S.frames.length < 2; gifBtn.disabled = vidBtn.disabled = !any || S.busy;
    }
    function status() { stat.textContent = S.shown >= 0 ? `Picture ${S.shown + 1} of ${S.frames.length}` : `${S.frames.length} picture${S.frames.length === 1 ? '' : 's'} · live`; }
    const strip = h('div.mk-strip', { role: 'listbox', 'aria-label': 'Pictures' });
    function paintStrip() {
      strip.replaceChildren(...S.frames.map((f, i) => {
        const t = h('canvas', { width: 96, height: Math.max(1, Math.round(96 * f.height / f.width)) });
        t.getContext('2d').drawImage(f, 0, 0, t.width, t.height);
        return h('button.mk-thumb', { type: 'button', role: 'option', 'aria-label': `Picture ${i + 1} of ${S.frames.length}`, onclick: () => { stopPlay(); look(i); } }, t, h('i', { text: String(i + 1) }));
      }));
      markStrip();
    }
    function markStrip() {
      [...strip.children].forEach((b, i) => { b.setAttribute('aria-selected', String(i === S.shown)); b.classList.toggle('is-on', i === S.shown); });
      if (S.shown >= 0) strip.children[S.shown]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }

    root.classList.add('mk');
    root.replaceChildren(
      h('div.mk-bar', startBtn, stopBtn, takeBtn, liveBtn, delBtn, h('span.mk-grow'), playBtn, h('label.mk-lbl', 'Speed', fpsIn, fpsOut)),
      h('div.mk-main',
        h('div.mk-stage', h('div.mk-paper.mk-sm', video, ghost, still, empty), stat),
        h('div.mk-side',
          h('div.mk-group', h('b.label', { text: 'Onion skin' }), onionBtn, h('label.mk-lbl', 'Strength', opIn)),
          h('div.mk-group', h('b.label', { text: 'Save' }), gifBtn, vidBtn, msg))),
      strip);
    video.hidden = false;
    btns(); status();

    const onKey = e => {
      if (!win.el.classList.contains('is-active') || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = document.activeElement, tag = t && t.tagName;
      if ((tag === 'INPUT' && t.type !== 'range') || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const k = e.key.toLowerCase();
      if (e.key === ' ' && tag !== 'BUTTON') take();
      else if (k === 'o') onionBtn.click();
      else if (k === 'p') play();
      else if (k === 'l') { if (S.stream) live(); }
      else if (e.key === ',') { stopPlay(); look(S.shown < 0 ? S.frames.length - 1 : S.shown - 1); }
      else if (e.key === '.') { stopPlay(); if (S.shown >= 0 && S.shown < S.frames.length - 1) look(S.shown + 1); else if (S.stream) live(); }
      else if (e.key === 'Delete') remove();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);

    return () => {
      S.dead = true; stopPlay();
      if (rec) rec.cancel();
      stopStream(S.stream); S.stream = null;
      window.removeEventListener('keydown', onKey);
    };
  },
});
