/* ============================================================
   audioeditor.js — Audio Editor

   Open a sound file from your files, see its waveform, select a range
   (drag on the waveform, or type the start and end), then trim, cut, fade
   in or out, change the gain or normalise. Every step can be undone. Save
   writes a NEW 16-bit WAV beside the original (named "… (edited).wav");
   the original is never touched.

   Why its own app: Recorder's editor trims its own video takes; this works
   on any sound file in Files and keeps the samples exactly. The arithmetic
   is js/core/wavedit.js (pure, tested against known samples).

   More edits: copy and paste inside the clip, reverse, silence, insert
   silence, trim the quiet off both ends, change speed, join a second file on
   the end, split at the cursor (two new files), and a noise gate and low-cut
   for mic recordings (rendered in an OfflineAudioContext). Zoom and a
   playhead sit on the waveform; click it to put the cursor there. Saves can
   be 8, 16 or 24-bit. Every edit is a new clip kept for Undo (the last 12
   steps; the screen says when that history is full); the original file is
   never written to.

   Reading files: WAV (PCM 8/16/24/32-bit and float) is read exactly at its
   own sample rate. Other formats go through the browser's decoder, which
   resamples to 44.1 kHz; the formats this browser can decode are listed
   on screen. Long files stay responsive: the waveform is drawn from a
   min/max summary (one pair per 256 samples), never from every sample.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import media from '../core/media.js';
import W from '../core/wavedit.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-audioplus-css')) {
  const l = document.createElement('link');
  l.id = 'feat-audioplus-css'; l.rel = 'stylesheet'; l.href = 'css/feat-audioplus.css';
  document.head.appendChild(l);
}
const MAX_UNDO = 12;

/** which compressed formats this browser can decode (WAV is always read by our own reader) */
function readable() {
  const a = typeof document !== 'undefined' ? document.createElement('audio') : null;
  const probe = [['MP3', 'audio/mpeg'], ['AAC/M4A', 'audio/mp4; codecs="mp4a.40.2"'], ['Ogg Vorbis', 'audio/ogg; codecs="vorbis"'], ['Opus', 'audio/ogg; codecs="opus"'], ['FLAC', 'audio/flac'], ['WebM audio', 'audio/webm; codecs="opus"']];
  return ['WAV', ...probe.filter(([, t]) => a && a.canPlayType && a.canPlayType(t)).map(([n]) => n)];
}

defineApp({
  id: 'audioeditor',
  name: 'Audio Editor',
  icon: 'crop',
  g1: '#45cdf0', g2: '#0874ad',
  category: 'Media',
  keywords: ['audio', 'sound', 'wav', 'trim', 'cut', 'fade', 'normalize', 'normalise', 'gain', 'volume', 'waveform', 'edit', 'editor', 'mp3'],
  desc: 'Trim, fade and adjust the volume of sound files',
  singleton: true,
  win: { w: 760, h: 560, minW: 420, minH: 420 },

  mount(ctx) {
    const { root, win, opts, api } = ctx;
    const { h, icon, vfs } = api;

    const E = { path: '', name: '', clip: null, py: null, undo: [], sel: null, rate: 44100, lossy: false, play: null, note: '', cursor: null, view: null, board: null, joining: false, playFrom: 0, playT0: 0, raf: 0, dropped: false };
    let ac = null, closed = false;

    /* ---------- loading ---------- */
    async function decode(blob) {
      const bytes = await blob.arrayBuffer();
      const wav = W.decodeWav(bytes);
      if (wav) return { clip: wav, lossy: false };
      const Off = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!Off) throw new Error('This browser cannot decode audio.');
      const buf = await new Off(2, 1, 44100).decodeAudioData(bytes.slice(0));
      return { clip: { rate: buf.sampleRate, ch: Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i).slice()) }, lossy: true };
    }
    async function openPath(path) {
      stop();
      const n = vfs.node(path);
      if (!n || n.type !== 'file') { say('That file is no longer there.', true); return; }
      say('Opening ' + n.name + '…');
      try {
        const blob = await media.blobOf(vfs.norm(path));
        if (!blob) throw new Error('This file has no sound data.');
        const { clip, lossy } = await decode(blob);
        if (closed) return;
        if (!W.length(clip)) throw new Error('This file has no samples.');
        E.path = vfs.norm(path); E.name = n.name; E.clip = clip; E.lossy = lossy; E.undo = []; E.sel = null; E.cursor = null; E.view = null; E.joining = false; E.pick = false;
        reindex();
        nameIn.value = n.name.replace(/\.[^.]+$/, '') + ' (edited).wav';
        say(lossy ? `Opened ${n.name}. This browser decoded it at ${clip.rate} Hz, so a saved copy will be at that rate.` : `Opened ${n.name} exactly as stored.`);
      } catch (e) {
        say(`Could not open ${n.name}: ${e && e.message ? e.message : 'this browser cannot decode it'}. It can read: ${readable().join(', ')}.`, true);
      }
      paint();
    }
    const reindex = () => { E.py = W.pyramid(E.clip); };

    /* ---------- editing ---------- */
    const total = () => W.length(E.clip);
    const range = () => (E.sel && E.sel[1] > E.sel[0] ? E.sel : [0, total()]);
    function apply(fn, msg) {
      if (!E.clip) return;
      const next = fn(E.clip);
      if (!next) return;
      E.undo.push(E.clip);
      const full = E.undo.length > MAX_UNDO;
      if (full) E.undo.shift();
      E.clip = next; reindex();
      if (E.sel) E.sel = E.sel[1] > total() ? null : E.sel;
      if (E.cursor != null && E.cursor > total()) E.cursor = null;
      E.view = null;
      stop(); say(full ? `${msg} The undo history was full, so the oldest of the ${MAX_UNDO} steps can no longer be undone.` : msg); paint();
    }
    async function applyAsync(fn, msg) {
      if (!E.clip) return;
      const before = E.clip;
      say('Working…');
      let next;
      try { next = await fn(before); } catch (e) { say('That did not work: ' + (e && e.message || e), true); return; }
      if (closed || E.clip !== before) return;
      if (!next) return;
      apply(() => next, typeof msg === 'function' ? msg() : msg);
    }
    const needSel = what => { if (E.sel && E.sel[1] > E.sel[0]) return true; say(`Drag on the waveform (or type a start and end) to choose what to ${what}.`, true); return false; };
    const doTrim = () => { if (needSel('keep')) { const [a, b] = E.sel; apply(c => W.trim(c, a, b), `Kept ${((b - a) / E.clip.rate).toFixed(3)} s.`); E.sel = null; paint(); } };
    const doCut = () => { if (needSel('cut')) { const [a, b] = E.sel; apply(c => W.cut(c, a, b), `Cut ${((b - a) / E.clip.rate).toFixed(3)} s.`); E.sel = null; paint(); } };
    const doFade = dir => {
      const len = Number(fadeLen.value);
      let [a, b] = range();
      if (len > 0) { const k = Math.min(total(), Math.round(len * E.clip.rate)); [a, b] = dir === 'in' ? [0, k] : [total() - k, total()]; }
      apply(c => W.fade(c, a, b, dir, shapeSel.value), `Faded ${dir === 'in' ? 'in' : 'out'} over ${((b - a) / E.clip.rate).toFixed(3)} s.`);
    };
    const doGain = () => {
      const db = Number(gainIn.value);
      if (!Number.isFinite(db) || db < -60 || db > 24) { say('Gain must be between -60 and +24 dB.', true); return; }
      const [a, b] = range(); apply(c => W.gain(c, a, b, W.dbToGain(db)), `Changed the volume by ${db > 0 ? '+' : ''}${db} dB.`);
    };
    const doNorm = () => {
      const t = Number(normIn.value);
      if (!Number.isFinite(t) || t > 0 || t < -60) { say('Normalise to a level between -60 and 0 dB.', true); return; }
      const [a, b] = range();
      let silent = false;
      apply(c => { const r = W.normalise(c, a, b, t); if (!r.changed) { silent = true; return null; } return r.clip; }, `Normalised so the loudest point is ${t} dB.`);
      if (silent) say('That part is silent, so there is nothing to normalise.', true);
    };

    /* ---------- more edits ---------- */
    const secs = n => (n / E.clip.rate).toFixed(3);
    const bits = () => Number(bitSel.value) || 16;
    const doReverse = () => { const [a, b] = range(); apply(c => W.reverse(c, a, b), `Reversed ${secs(b - a)} s.`); };
    const doSilence = () => { const [a, b] = range(); apply(c => W.silence(c, a, b), `Silenced ${secs(b - a)} s (the length is the same).`); };
    const doInsert = () => {
      const t = Number(insIn.value);
      if (!Number.isFinite(t) || t <= 0 || t > 600) { say('Silence can be between 0.001 and 600 seconds long.', true); return; }
      const at = E.cursor != null ? E.cursor : (E.sel && E.sel[1] > E.sel[0] ? E.sel[0] : total());
      const k = Math.round(t * E.clip.rate);
      apply(c => W.insertSilence(c, at, k), `Put ${secs(k)} s of silence in at ${secs(at)} s.`);
    };
    const doTrimSilence = () => {
      const db = Number(quietIn.value);
      if (!Number.isFinite(db) || db > -10 || db < -90) { say('Quiet level must be between -90 and -10 dB.', true); return; }
      const sp = W.loudSpan(E.clip, db);
      if (!sp) { say(`Nothing here is louder than ${db} dB, so there is nothing to keep.`, true); return; }
      if (sp[0] === 0 && sp[1] === total()) { say(`Both ends are already louder than ${db} dB, so nothing was trimmed.`); return; }
      apply(c => W.trim(c, sp[0], sp[1]), `Trimmed ${secs(sp[0])} s off the start and ${secs(total() - sp[1])} s off the end.`);
    };
    const doCopy = () => { if (!needSel('copy')) return; const [a, b] = E.sel; E.clipboard = W.slice(E.clip, a, b); say(`Copied ${secs(b - a)} s. Click where it should go on the waveform, then press Paste.`); paint(); };
    const doPaste = () => {
      if (!E.clipboard) { say('Copy a selection first.', true); return; }
      const at = E.cursor != null ? E.cursor : (E.sel && E.sel[1] > E.sel[0] ? E.sel[1] : total());
      const frag = E.clipboard.rate === E.clip.rate ? E.clipboard : W.conform(E.clipboard, E.clip.rate, E.clipboard.ch.length);
      const k = W.length(frag);
      apply(c => W.paste(c, at, frag), `Pasted ${secs(k)} s in at ${secs(at)} s.`);
      E.sel = [at, at + k]; E.cursor = at; paint();
    };
    const doSpeed = () => {
      const f = Number(speedIn.value);
      if (!Number.isFinite(f) || f < 0.25 || f > 4) { say('Speed must be between 0.25 and 4 (1 is unchanged).', true); return; }
      if (f === 1) { say('A speed of 1 changes nothing.'); return; }
      const [a, b] = range();
      apply(c => W.speed(c, a, b, f), `Changed the speed to ${f}x. The pitch follows the speed, like a tape.`);
    };
    async function joinPath(path) {
      E.joining = false; E.pick = false;
      const n = vfs.node(path);
      if (!n || n.type !== 'file') { say('That file is no longer there.', true); paint(); return; }
      say('Opening ' + n.name + '…');
      try {
        const blob = await media.blobOf(vfs.norm(path));
        if (!blob) throw new Error('This file has no sound data.');
        const { clip } = await decode(blob);
        if (closed || !E.clip) return;
        if (!W.length(clip)) throw new Error('This file has no samples.');
        const note = clip.rate !== E.clip.rate ? ` It was converted from ${clip.rate} Hz to ${E.clip.rate} Hz.` : '';
        apply(c => W.join(c, clip), `Joined ${n.name} (${(W.length(clip) / clip.rate).toFixed(3)} s) on the end.${note}`);
      } catch (e) { say(`Could not join ${n.name}: ${e && e.message ? e.message : 'this browser cannot decode it'}.`, true); paint(); }
    }
    async function doSplit() {
      if (!E.clip) return;
      const at = E.cursor;
      if (at == null || at <= 0 || at >= total()) { say('Click on the waveform where the file should be split, away from the very ends.', true); return; }
      const base = nameIn.value.replace(/\.wav$/i, '').replace(/ \(edited\)$/, '').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'split';
      try {
        const dir = vfs.parentPath(E.path) || vfs.HOME + '/Music';
        const one = await media.save(dir, `${base} (part 1).wav`, new Blob([W.encodeWav(W.trim(E.clip, 0, at), bits())], { type: 'audio/wav' }));
        const two = await media.save(dir, `${base} (part 2).wav`, new Blob([W.encodeWav(W.trim(E.clip, at, total()), bits())], { type: 'audio/wav' }));
        say(`Split at ${secs(at)} s into two new files: ${vfs.baseName(one.path)} and ${vfs.baseName(two.path)}. This clip and the original are unchanged.`);
      } catch (e) { say('Could not save: ' + (e && e.message || e), true); }
    }
    /* noise gate and low-cut, rendered in an OfflineAudioContext (one graph: filter, then the gate's gain curve) */
    async function cleaned(clip, a, b, { gateDb, cutHz }) {
      const Off = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!Off) throw new Error('This browser has no OfflineAudioContext.');
      const n = W.length(clip), chans = clip.ch.length;
      const oac = new Off(chans, n, clip.rate);
      const buf = oac.createBuffer(chans, n, clip.rate);
      clip.ch.forEach((d, i) => buf.copyToChannel(d, i));
      const src = oac.createBufferSource(); src.buffer = buf;
      let node = src;
      if (cutHz) { const f = oac.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = cutHz; f.Q.value = 0.707; node.connect(f); node = f; }
      let share = 0;
      if (gateDb != null) {
        const cv = W.gateCurve(clip, gateDb);
        share = W.gatedShare(cv);
        const g = oac.createGain();
        if (cv.gain.length >= 2) g.gain.setValueCurveAtTime(cv.gain, 0, (cv.gain.length - 1) * cv.hop / clip.rate); else g.gain.value = 1;
        node.connect(g); node = g;
      }
      node.connect(oac.destination);
      src.start();
      const out = await oac.startRendering();
      const res = { rate: clip.rate, ch: clip.ch.map((d, i) => { const o = d.slice(); o.set(out.getChannelData(i).subarray(a, b), a); return o; }) };
      return { clip: res, share };
    }
    const doGate = () => {
      const db = Number(gateIn.value);
      if (!Number.isFinite(db) || db > -10 || db < -90) { say('Gate level must be between -90 and -10 dB.', true); return; }
      const [a, b] = range();
      let share = 0;
      applyAsync(async c => {
        const r = await cleaned(c, a, b, { gateDb: db });
        share = r.share;
        if (!(share > 0)) { say(`Nothing in ${E.sel ? 'the selection' : 'the clip'} is quieter than ${db} dB, so the gate changed nothing.`); return null; }
        return r.clip;
      }, () => `Noise gate at ${db} dB: it closed on about ${Math.round(share * 100)}% of the file.`);
    };
    const doLowCut = () => {
      const hz = Number(cutIn.value);
      if (!Number.isFinite(hz) || hz < 20 || hz > 2000) { say('Low-cut frequency must be between 20 and 2000 Hz.', true); return; }
      const [a, b] = range();
      applyAsync(async c => (await cleaned(c, a, b, { cutHz: hz })).clip, `Low-cut at ${hz} Hz: rumble and thumps below it are taken out.`);
    };
    const doUndo = () => { const c = E.undo.pop(); if (!c) return; E.clip = c; reindex(); E.sel = null; if (E.cursor != null && E.cursor > total()) E.cursor = null; E.view = null; stop(); say('Undone.'); paint(); };
    async function doSave() {
      if (!E.clip) return;
      let name = nameIn.value.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (!name) { say('Give the new file a name.', true); return; }
      if (!/\.wav$/i.test(name)) name += '.wav';
      try {
        const dir = vfs.parentPath(E.path) || vfs.HOME + '/Music';
        const { path } = await media.save(dir, name, new Blob([W.encodeWav(E.clip, bits())], { type: 'audio/wav' }));
        say(`Saved a new ${bits()}-bit file: ${vfs.baseName(path)}. The original is unchanged.`);
        E.saved = path;
      } catch (e) { say('Could not save: ' + (e && e.message || e), true); }
    }

    /* ---------- playback of what you hear (selection, else from the cursor, else all) ---------- */
    function stop() { if (E.play) { const p = E.play; E.play = null; try { p.stop(); } catch (e) { /* ended */ } } cancelAnimationFrame(E.raf); E.raf = 0; if (canvas) { canvas.dataset.play = ''; } if (btnPlay) btnPlay.textContent = 'Play'; if (E.clip && canvas) draw(); }
    const playRange = () => (E.sel && E.sel[1] > E.sel[0] ? E.sel : [E.cursor != null && E.cursor < total() ? E.cursor : 0, total()]);
    function play() {
      if (!E.clip) return;
      if (E.play) { stop(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { say('This browser has no Web Audio.', true); return; }
      if (!ac) ac = new AC();
      ac.resume().catch(() => {});
      const [a, b] = playRange();
      const buf = ac.createBuffer(E.clip.ch.length, b - a, E.clip.rate);
      E.clip.ch.forEach((d, i) => buf.copyToChannel(d.subarray(a, b), i));
      const s = ac.createBufferSource(); s.buffer = buf; s.connect(ac.destination);
      s.onended = () => { if (E.play === s) { E.play = null; cancelAnimationFrame(E.raf); E.raf = 0; canvas.dataset.play = ''; btnPlay.textContent = 'Play'; draw(); } };
      s.start(); E.play = s; E.playFrom = a; E.playTo = b; E.playT0 = ac.currentTime; btnPlay.textContent = 'Stop';
      const frame = () => {
        if (E.play !== s) return;
        const pos = Math.min(E.playTo, E.playFrom + Math.round((ac.currentTime - E.playT0) * E.clip.rate));
        canvas.dataset.play = String(pos);
        draw();
        E.raf = requestAnimationFrame(frame);
      };
      frame();
    }

    /* ---------- screen ---------- */
    const note = h('div.ae__note', { role: 'status', 'aria-live': 'polite' });
    function say(t, bad) { E.note = t; note.textContent = t; note.classList.toggle('is-bad', !!bad); }
    const canvas = h('canvas.ae__wave', { role: 'img', 'aria-label': 'Waveform. Click to place the cursor, drag to select a range.', tabindex: '0' });
    const info = h('div.ae__info.mono');
    const loud = h('div.ae__loud.mono');
    const hist = h('div.ae__hist', { role: 'status' });
    const selA = h('input.ae__num', { type: 'number', step: '0.001', min: '0', 'aria-label': 'Selection start in seconds', onchange: () => typed() });
    const selB = h('input.ae__num', { type: 'number', step: '0.001', min: '0', 'aria-label': 'Selection end in seconds', onchange: () => typed() });
    const shapeSel = h('select.synth__sel', { 'aria-label': 'Fade shape' }, h('option', { value: 'linear', text: 'Linear fade' }), h('option', { value: 'curve', text: 'Smooth fade' }));
    const fadeLen = h('select.synth__sel', { 'aria-label': 'Fade length' },
      h('option', { value: '0', text: 'Fade the selection' }), ...[0.25, 0.5, 1, 2, 5].map(v => h('option', { value: String(v), text: `Fade ${v} s at the end` })));
    const gainIn = h('input.ae__num', { type: 'number', step: '0.5', value: '3', 'aria-label': 'Gain in decibels' });
    const normIn = h('input.ae__num', { type: 'number', step: '0.5', value: '-1', 'aria-label': 'Normalise to decibels' });
    const insIn = h('input.ae__num', { type: 'number', step: '0.1', min: '0', value: '0.5', 'aria-label': 'Seconds of silence to insert' });
    const quietIn = h('input.ae__num', { type: 'number', step: '5', value: '-50', 'aria-label': 'Quiet level in decibels' });
    const speedIn = h('input.ae__num', { type: 'number', step: '0.25', min: '0.25', max: '4', value: '1.5', 'aria-label': 'Speed factor' });
    const gateIn = h('input.ae__num', { type: 'number', step: '1', value: '-45', 'aria-label': 'Noise gate level in decibels' });
    const cutIn = h('input.ae__num', { type: 'number', step: '10', min: '20', max: '2000', value: '80', 'aria-label': 'Low-cut frequency in hertz' });
    const bitSel = h('select.synth__sel', { 'aria-label': 'WAV bit depth' }, h('option', { value: '8', text: '8-bit' }), h('option', { value: '16', text: '16-bit', selected: true }), h('option', { value: '24', text: '24-bit' }));
    const nameIn = h('input.ae__name', { type: 'text', 'aria-label': 'New file name', onkeydown: e => e.stopPropagation() });
    const btn = (t, fn, label) => h('button.btn.btn--sm', { type: 'button', text: t, onclick: fn, ...(label ? { 'aria-label': label } : {}) });
    const btnPlay = btn('Play', play);
    const bUndo = btn('Undo', doUndo);
    const bPaste = btn('Paste', doPaste);
    const bZoomIn = btn('+', () => zoom(2), 'Zoom in'), bZoomOut = btn('−', () => zoom(0.5), 'Zoom out'), bZoomAll = btn('Whole clip', () => { E.view = null; paint(); });
    const scroll = h('input.slider.ae__scroll', { type: 'range', min: '0', max: '1000', step: '1', value: '0', 'aria-label': 'Scroll the zoomed waveform', oninput: e => {
      const n = total(), [v0, v1] = viewOf(), span = v1 - v0;
      if (span >= n) return;
      const a = Math.round(Number(e.target.value) / 1000 * (n - span));
      E.view = [a, a + span]; draw(); zoomInfo();
    } });
    const zoomOut = h('span.ae__zinfo.mono');
    const files = h('div.ae__files', { role: 'list', 'aria-label': 'Sound files' });
    const fmts = h('div.ae__fmts', { text: `Reads: ${readable().join(', ')}. WAV is read exactly; other formats are decoded by this browser at 44.1 kHz. Saves as 16-bit WAV by default; the Save row can also write 8-bit or 24-bit.` });
    const grp = (label, ...kids) => h('div.ae__selrow.ae__grp', { role: 'group', 'aria-label': label }, h('span.ae__glabel', { text: label }), ...kids);
    const edits = grp('Edit',
      btn('Copy selection', doCopy), bPaste, btn('Reverse', doReverse), btn('Silence', doSilence),
      h('label.ae__lab', h('span', { text: 'Silence s' }), insIn), btn('Insert silence', doInsert),
      btn('Split at cursor', doSplit), btn('Join a file…', () => { E.joining = true; E.pick = true; paint(); }));
    const shape = grp('Shape',
      h('label.ae__lab', h('span', { text: 'Quiet dB' }), quietIn), btn('Trim silence from ends', doTrimSilence),
      h('label.ae__lab', h('span', { text: 'Speed ×' }), speedIn), btn('Change speed', doSpeed));
    const clean = grp('Clean up a mic recording',
      h('label.ae__lab', h('span', { text: 'Gate dB' }), gateIn), btn('Noise gate', doGate),
      h('label.ae__lab', h('span', { text: 'Cut below Hz' }), cutIn), btn('Low-cut', doLowCut));
    const tools = h('div.ae__tools',
      btn('Trim to selection', doTrim), btn('Cut selection', doCut),
      btn('Fade in', () => doFade('in')), btn('Fade out', () => doFade('out')), fadeLen, shapeSel,
      h('label.ae__lab', h('span', { text: 'Gain dB' }), gainIn), btn('Apply gain', doGain),
      h('label.ae__lab', h('span', { text: 'Peak dB' }), normIn), btn('Normalise', doNorm),
      bUndo, btnPlay);
    const editor = h('div.ae__editor', { hidden: true },
      canvas,
      info,
      h('div.ae__selrow', h('label.ae__lab', h('span', { text: 'Start s' }), selA), h('label.ae__lab', h('span', { text: 'End s' }), selB), btn('Select all', () => { E.sel = [0, total()]; paint(); }),
        bZoomOut, bZoomIn, bZoomAll, scroll, zoomOut),
      tools,
      h('div.ae__save', h('label.ae__lab', h('span', { text: 'Save as new file' }), nameIn), bitSel, btn('Save a copy', doSave)),
      loud, hist, edits, shape, clean);
    root.appendChild(h('div.app.app--col.ae',
      h('div.app__bar', h('div.app__title', { text: 'Audio Editor' }), h('div.grow'), btn('Open file…', () => { E.joining = false; E.pick = !E.pick; paint(); })),
      h('div.ae__body', files, editor, note, fmts)));

    const fmtT = s => s.toFixed(3);
    function typed() {
      if (!E.clip) return;
      const r = E.clip.rate;
      /* a blank end means "to the end of the file", a blank start "from the beginning" */
      const a = Math.round(Math.max(0, Number(selA.value) || 0) * r);
      const b = selB.value === '' ? total() : Math.round(Math.max(0, Number(selB.value) || 0) * r);
      E.sel = [Math.min(a, total()), Math.min(Math.max(a, b), total())];
      /* redraw the wave only: rewriting the boxes would overwrite the other one while it is being typed */
      canvas.dataset.sel = E.sel[1] > E.sel[0] ? E.sel.join(',') : '';
      draw();
    }

    function listFiles() {
      const items = [];
      vfs.walk(vfs.HOME, (n, p) => { if (n.type === 'file' && n.kind === 'audio' && String(n.content || '').startsWith('staticos-media:')) items.push({ p, n }); });
      items.sort((x, y) => x.n.name.localeCompare(y.n.name));
      files.replaceChildren(items.length
        ? h('div.ae__fhead', { text: E.joining ? 'Choose a file to put on the end of this one' : 'Choose a sound file' })
        : h('div.ae__fhead', { text: 'No sound files yet. Record one in Recorder, Piano or Loop Station, or add one in Files.' }),
        ...items.slice(0, 200).map(({ p, n }) => h('button.ae__file', { type: 'button', role: 'listitem', dataset: { path: p }, onclick: () => { if (E.joining) joinPath(p); else { E.pick = false; openPath(p); } } }, icon('music'), h('span', { text: n.name }), h('span.ae__fdir', { text: vfs.parentPath(p).replace(vfs.HOME, '~') }))));
    }

    /* the part of the clip on screen: all of it, or a zoomed window */
    const viewOf = () => { const n = total(); const v = E.view; return v && v[1] - v[0] < n ? [Math.max(0, v[0]), Math.min(n, v[1])] : [0, n]; };
    function zoom(f) {
      if (!E.clip) return;
      const n = total(), [v0, v1] = viewOf(), span = v1 - v0;
      const focus = E.play ? Number(canvas.dataset.play) : E.cursor != null ? E.cursor : (E.sel && E.sel[1] > E.sel[0] ? (E.sel[0] + E.sel[1]) / 2 : (v0 + v1) / 2);
      const minSpan = Math.min(n, 64);
      const ns = Math.max(minSpan, Math.min(n, Math.round(span / f)));
      if (ns >= n) { E.view = null; paint(); return; }
      const a = Math.round(Math.max(0, Math.min(n - ns, focus - ns / 2)));
      E.view = [a, a + ns]; paint();
    }
    function zoomInfo() {
      const [v0, v1] = viewOf(), n = total();
      zoomOut.textContent = v1 - v0 >= n ? 'Showing all' : `Showing ${fmtT(v0 / E.clip.rate)} to ${fmtT(v1 / E.clip.rate)} s`;
      canvas.dataset.view = v1 - v0 >= n ? '' : `${v0},${v1}`;
      scroll.disabled = v1 - v0 >= n;
      scroll.value = v1 - v0 >= n ? '0' : String(Math.round(v0 / (n - (v1 - v0)) * 1000));
      bZoomOut.disabled = v1 - v0 >= n;
      bZoomIn.disabled = v1 - v0 <= Math.min(n, 64);
    }

    function draw() {
      const dpr = window.devicePixelRatio || 1;
      const wpx = Math.max(200, Math.floor(canvas.clientWidth * dpr)), hpx = Math.floor(160 * dpr);
      if (canvas.width !== wpx) canvas.width = wpx;
      if (canvas.height !== hpx) canvas.height = hpx;
      const g = canvas.getContext('2d');
      const cs = getComputedStyle(canvas);
      g.clearRect(0, 0, wpx, hpx);
      if (!E.clip) return;
      const [v0, v1] = viewOf(), span = Math.max(1, v1 - v0);
      const X = s => (s - v0) / span * wpx;
      const pk = W.peaks(E.clip, E.py, v0, v1, wpx);
      if (E.sel && E.sel[1] > E.sel[0]) {
        g.fillStyle = cs.getPropertyValue('--accent') || '#7a5cff'; g.globalAlpha = 0.25;
        const x0 = Math.max(0, X(E.sel[0])), x1 = Math.min(wpx, X(E.sel[1]));
        if (x1 > x0) g.fillRect(x0, 0, x1 - x0, hpx);
        g.globalAlpha = 1;
      }
      g.fillStyle = cs.getPropertyValue('--ink-1') || '#ddd';
      const mid = hpx / 2;
      for (let x = 0; x < wpx; x++) {
        const y0 = mid - Math.min(1, pk.hi[x]) * mid, y1 = mid - Math.max(-1, pk.lo[x]) * mid;
        g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
      }
      const line = (s, color) => { if (s == null || s < v0 || s > v1) return; g.fillStyle = color; g.fillRect(Math.round(X(s)) - 1, 0, Math.max(2, Math.round(dpr)), hpx); };
      line(E.cursor, cs.getPropertyValue('--warn') || '#ffc266');
      if (E.play) line(Number(canvas.dataset.play) || E.playFrom, cs.getPropertyValue('--accent') || '#7a5cff');
    }
    function paint() {
      const has = !!E.clip;
      files.hidden = has && !E.pick; editor.hidden = !has;
      if (!files.hidden) listFiles();
      if (has) {
        const pk = W.peakOf(E.clip);
        info.textContent = `${E.name} · ${fmtT(W.seconds(E.clip))} s · ${E.clip.rate} Hz · ${E.clip.ch.length === 1 ? 'mono' : E.clip.ch.length + ' channels'} · ${total()} samples · peak ${pk > 0 ? W.gainToDb(pk).toFixed(1) + ' dB' : 'silent'}${E.cursor != null ? ` · cursor ${fmtT(E.cursor / E.clip.rate)} s` : ''}`;
        const s = E.sel && E.sel[1] > E.sel[0] ? E.sel : null;
        selA.value = s ? fmtT(s[0] / E.clip.rate) : ''; selB.value = s ? fmtT(s[1] / E.clip.rate) : '';
        canvas.dataset.sel = s ? s.join(',') : '';
        canvas.dataset.cursor = E.cursor != null ? String(E.cursor) : '';
        const [a, b] = range();
        const rms = W.rmsDb(E.clip, a, b), pkr = W.peakOf(E.clip, a, b);
        loud.textContent = `Loudness of ${s ? 'the selection' : 'the whole clip'}: RMS ${Number.isFinite(rms) ? rms.toFixed(1) + ' dB' : 'silent'}, peak ${pkr > 0 ? W.gainToDb(pkr).toFixed(1) + ' dB' : 'silent'} (both relative to full scale)`;
        zoomInfo();
        draw();
      }
      bUndo.disabled = !E.undo.length;
      bPaste.disabled = !E.clipboard;
      const n = E.undo.length;
      hist.textContent = n >= MAX_UNDO ? `Undo history is full (${n} of ${MAX_UNDO} steps). The next edit forgets the oldest step.` : `Undo history: ${n} of ${MAX_UNDO} steps.`;
      hist.classList.toggle('is-bad', n >= MAX_UNDO);
    }

    /* click to place the cursor, drag to choose a range */
    let drag = null, dragX = 0;
    const xToSample = e => { const r = canvas.getBoundingClientRect(); const [v0, v1] = viewOf(); return Math.round(v0 + Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * (v1 - v0)); };
    canvas.addEventListener('pointerdown', e => { if (!E.clip) return; canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId); drag = xToSample(e); dragX = e.clientX; E.cursor = drag; E.sel = null; paint(); });
    canvas.addEventListener('pointermove', e => { if (drag == null) return; if (Math.abs(e.clientX - dragX) < 3 && !E.sel) return; const x = xToSample(e); E.sel = [Math.min(drag, x), Math.max(drag, x)]; paint(); });
    const endDrag = () => { drag = null; };
    canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('wheel', e => { if (!E.clip || !(e.ctrlKey || e.metaKey)) return; e.preventDefault(); zoom(e.deltaY < 0 ? 1.5 : 1 / 1.5); }, { passive: false });
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (E.clip) draw(); }) : null;
    if (ro) ro.observe(canvas);

    paint();
    if (opts && typeof opts.path === 'string') openPath(opts.path); else { E.pick = true; paint(); }
    win.onReopen && win.onReopen(o => { if (o && typeof o.path === 'string') openPath(o.path); });

    return () => {
      closed = true;
      stop();
      if (ro) ro.disconnect();
      if (ac) { try { ac.close(); } catch (e) { /* closing */ } ac = null; }
    };
  },
});
