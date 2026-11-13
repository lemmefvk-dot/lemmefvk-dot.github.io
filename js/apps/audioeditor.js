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

    const E = { path: '', name: '', clip: null, py: null, undo: [], sel: null, rate: 44100, lossy: false, play: null, note: '' };
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
        E.path = vfs.norm(path); E.name = n.name; E.clip = clip; E.lossy = lossy; E.undo = []; E.sel = null;
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
      E.undo.push(E.clip); if (E.undo.length > MAX_UNDO) E.undo.shift();
      E.clip = next; reindex();
      if (E.sel) E.sel = E.sel[1] > total() ? null : E.sel;
      stop(); say(msg); paint();
    }
    const needSel = what => { if (E.sel && E.sel[1] > E.sel[0]) return true; say(`Drag on the waveform (or type a start and end) to choose what to ${what}.`, true); return false; };
    const doTrim = () => { if (needSel('keep')) { const [a, b] = E.sel; apply(c => W.trim(c, a, b), `Kept ${((b - a) / E.clip.rate).toFixed(3)} s.`); E.sel = null; paint(); } };
    const doCut = () => { if (needSel('cut')) { const [a, b] = E.sel; apply(c => W.cut(c, a, b), `Cut ${((b - a) / E.clip.rate).toFixed(3)} s.`); E.sel = null; paint(); } };
    const doFade = dir => { const [a, b] = range(); apply(c => W.fade(c, a, b, dir, shapeSel.value), `Faded ${dir === 'in' ? 'in' : 'out'} over ${((b - a) / E.clip.rate).toFixed(3)} s.`); };
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
    const doUndo = () => { const c = E.undo.pop(); if (!c) return; E.clip = c; reindex(); E.sel = null; stop(); say('Undone.'); paint(); };
    async function doSave() {
      if (!E.clip) return;
      let name = nameIn.value.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (!name) { say('Give the new file a name.', true); return; }
      if (!/\.wav$/i.test(name)) name += '.wav';
      try {
        const dir = vfs.parentPath(E.path) || vfs.HOME + '/Music';
        const { path } = await media.save(dir, name, new Blob([W.encodeWav(E.clip)], { type: 'audio/wav' }));
        say(`Saved a new file: ${vfs.baseName(path)}. The original is unchanged.`);
        E.saved = path;
      } catch (e) { say('Could not save: ' + (e && e.message || e), true); }
    }

    /* ---------- playback of what you hear (selection or all) ---------- */
    function stop() { if (E.play) { try { E.play.stop(); } catch (e) { /* ended */ } E.play = null; } btnPlay && (btnPlay.textContent = 'Play'); }
    function play() {
      if (!E.clip) return;
      if (E.play) { stop(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { say('This browser has no Web Audio.', true); return; }
      if (!ac) ac = new AC();
      ac.resume().catch(() => {});
      const [a, b] = range();
      const buf = ac.createBuffer(E.clip.ch.length, b - a, E.clip.rate);
      E.clip.ch.forEach((d, i) => buf.copyToChannel(d.subarray(a, b), i));
      const s = ac.createBufferSource(); s.buffer = buf; s.connect(ac.destination);
      s.onended = () => { if (E.play === s) { E.play = null; btnPlay.textContent = 'Play'; } };
      s.start(); E.play = s; btnPlay.textContent = 'Stop';
    }

    /* ---------- screen ---------- */
    const note = h('div.ae__note', { role: 'status', 'aria-live': 'polite' });
    function say(t, bad) { E.note = t; note.textContent = t; note.classList.toggle('is-bad', !!bad); }
    const canvas = h('canvas.ae__wave', { role: 'img', 'aria-label': 'Waveform. Drag to select a range.', tabindex: '0' });
    const info = h('div.ae__info.mono');
    const selA = h('input.ae__num', { type: 'number', step: '0.001', min: '0', 'aria-label': 'Selection start in seconds', onchange: () => typed() });
    const selB = h('input.ae__num', { type: 'number', step: '0.001', min: '0', 'aria-label': 'Selection end in seconds', onchange: () => typed() });
    const shapeSel = h('select.synth__sel', { 'aria-label': 'Fade shape' }, h('option', { value: 'linear', text: 'Linear fade' }), h('option', { value: 'curve', text: 'Smooth fade' }));
    const gainIn = h('input.ae__num', { type: 'number', step: '0.5', value: '3', 'aria-label': 'Gain in decibels' });
    const normIn = h('input.ae__num', { type: 'number', step: '0.5', value: '-1', 'aria-label': 'Normalise to decibels' });
    const nameIn = h('input.ae__name', { type: 'text', 'aria-label': 'New file name', onkeydown: e => e.stopPropagation() });
    const btn = (t, fn, label) => h('button.btn.btn--sm', { type: 'button', text: t, onclick: fn, ...(label ? { 'aria-label': label } : {}) });
    const btnPlay = btn('Play', play);
    const bUndo = btn('Undo', doUndo);
    const files = h('div.ae__files', { role: 'list', 'aria-label': 'Sound files' });
    const fmts = h('div.ae__fmts', { text: `Reads: ${readable().join(', ')}. WAV is read exactly; other formats are decoded by this browser at 44.1 kHz. Saves as 16-bit WAV.` });
    const tools = h('div.ae__tools',
      btn('Trim to selection', doTrim), btn('Cut selection', doCut),
      btn('Fade in', () => doFade('in')), btn('Fade out', () => doFade('out')), shapeSel,
      h('label.ae__lab', h('span', { text: 'Gain dB' }), gainIn), btn('Apply gain', doGain),
      h('label.ae__lab', h('span', { text: 'Peak dB' }), normIn), btn('Normalise', doNorm),
      bUndo, btnPlay);
    const editor = h('div.ae__editor', { hidden: true },
      canvas, info,
      h('div.ae__selrow', h('label.ae__lab', h('span', { text: 'Start s' }), selA), h('label.ae__lab', h('span', { text: 'End s' }), selB), btn('Select all', () => { E.sel = [0, total()]; paint(); })),
      tools,
      h('div.ae__save', h('label.ae__lab', h('span', { text: 'Save as new file' }), nameIn), btn('Save a copy', doSave)));
    root.appendChild(h('div.app.app--col.ae',
      h('div.app__bar', h('div.app__title', { text: 'Audio Editor' }), h('div.grow'), btn('Open file…', () => { E.pick = !E.pick; paint(); })),
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
        ? h('div.ae__fhead', { text: 'Choose a sound file' })
        : h('div.ae__fhead', { text: 'No sound files yet. Record one in Recorder, Piano or Loop Station, or add one in Files.' }),
        ...items.slice(0, 200).map(({ p, n }) => h('button.ae__file', { type: 'button', role: 'listitem', dataset: { path: p }, onclick: () => { E.pick = false; openPath(p); } }, icon('music'), h('span', { text: n.name }), h('span.ae__fdir', { text: vfs.parentPath(p).replace(vfs.HOME, '~') }))));
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
      const n = total();
      const pk = W.peaks(E.clip, E.py, 0, n, wpx);
      if (E.sel && E.sel[1] > E.sel[0]) {
        g.fillStyle = cs.getPropertyValue('--accent') || '#7a5cff'; g.globalAlpha = 0.25;
        g.fillRect(E.sel[0] / n * wpx, 0, (E.sel[1] - E.sel[0]) / n * wpx, hpx); g.globalAlpha = 1;
      }
      g.fillStyle = cs.getPropertyValue('--ink-1') || '#ddd';
      const mid = hpx / 2;
      for (let x = 0; x < wpx; x++) {
        const y0 = mid - Math.min(1, pk.hi[x]) * mid, y1 = mid - Math.max(-1, pk.lo[x]) * mid;
        g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
      }
    }
    function paint() {
      const has = !!E.clip;
      files.hidden = has && !E.pick; editor.hidden = !has;
      if (!files.hidden) listFiles();
      if (has) {
        const pk = W.peakOf(E.clip);
        info.textContent = `${E.name} · ${fmtT(W.seconds(E.clip))} s · ${E.clip.rate} Hz · ${E.clip.ch.length === 1 ? 'mono' : E.clip.ch.length + ' channels'} · ${total()} samples · peak ${pk > 0 ? W.gainToDb(pk).toFixed(1) + ' dB' : 'silent'}`;
        const s = E.sel && E.sel[1] > E.sel[0] ? E.sel : null;
        selA.value = s ? fmtT(s[0] / E.clip.rate) : ''; selB.value = s ? fmtT(s[1] / E.clip.rate) : '';
        canvas.dataset.sel = s ? s.join(',') : '';
        draw();
      }
      bUndo.disabled = !E.undo.length;
    }

    /* drag on the waveform to choose a range */
    let drag = null;
    const xToSample = e => { const r = canvas.getBoundingClientRect(); return Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * total()); };
    canvas.addEventListener('pointerdown', e => { if (!E.clip) return; canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId); drag = xToSample(e); E.sel = null; paint(); });
    canvas.addEventListener('pointermove', e => { if (drag == null) return; const x = xToSample(e); E.sel = [Math.min(drag, x), Math.max(drag, x)]; paint(); });
    const endDrag = () => { drag = null; };
    canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
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
