/* ============================================================
   flipbook.js — Flipbook: draw an animation one frame at a time.

   A page is a 480x320 sheet of white paper. Draw on it with a pen or an
   eraser; add a frame and the one before shows through faintly (the onion
   skin) so you can see where things were. Play runs the pages at 1–24
   frames a second. Save keeps the animation in ~/Pictures/Flipbook:
     · GIF    written by js/core/gif.js (the encoder Picture Tools uses)
     · Video  a WebM, played back into MediaRecorder in real time
     · PNG    the page you are on
   The book is kept as a draft (store key 'portal.flipbook') so closing the
   window loses nothing, until it grows too big for that — then the page
   says so, and a saved GIF or video is the copy to keep.

   Drawing needs a pointer; everything else has a key:
     , and .   previous / next page     N  new page      D  copy this page
     Space     play / stop              O  onion skin    B / E  pen / eraser
     Ctrl+Z    undo a stroke            Delete  remove this page
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { encodeGif } from '../core/gif.js';
import { saveBlob } from '../photos/pt-common.js';
import { makerCss, blobOf, frameData, recordCanvases, clamp } from '../core/makerkit.js';

makerCss();
const KEY = 'portal.flipbook';
const W = 480, H = 320;
const MAX_FRAMES = 120;
const DRAFT_LIMIT = 2_500_000;       /* characters of saved draft; beyond that the draft stops updating */
const COLOURS = ['#1b1b1f', '#e5484d', '#f5a524', '#f7d531', '#3dd68c', '#3b82f6', '#8b5cf6', '#ffffff'];

const blank = () => {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  return c;
};
const copyOf = src => { const c = blank(); c.getContext('2d').drawImage(src, 0, 0); return c; };

defineApp({
  id: 'flipbook',
  name: 'Flipbook',
  icon: 'film',
  g1: '#ffb454', g2: '#e5484d',
  category: 'Create',
  keywords: ['animation', 'animate', 'frame by frame', 'draw', 'cartoon', 'gif', 'onion skin', 'flip book', 'stick figure', 'video', 'sketch'],
  desc: 'Draw an animation frame by frame and save it as a GIF or video',
  singleton: true,
  win: { w: 900, h: 640, minW: 560, minH: 460 },
  shortcuts: [
    [', / .', 'Previous / next page'], ['N', 'New page'], ['D', 'Copy this page'], ['Space', 'Play / stop'],
    ['O', 'Onion skin on / off'], ['B / E', 'Pen / eraser'], ['Ctrl+Z', 'Undo a stroke'], ['Delete', 'Remove this page'],
  ],

  mount(ctx) {
    const { root, win, api } = ctx;
    const { h, icon, store } = api;

    const S = { frames: [blank()], i: 0, fps: 8, tool: 'pen', colour: COLOURS[0], size: 4, onion: true, playing: 0, undo: [[]], msg: '', busy: null, dead: false };
    let draftTimer = 0, draftBlocked = false, thumbs = [], rec = null;

    /* ---------- the page ---------- */
    const view = h('canvas.mk-paper__cv', { width: W, height: H, tabindex: '0', role: 'img', 'aria-label': 'Drawing page. Draw with a pointer.' });
    const vg = view.getContext('2d');
    function render() {
      vg.globalCompositeOperation = 'source-over';
      vg.fillStyle = '#fff'; vg.fillRect(0, 0, W, H);
      if (S.onion && !S.playing && S.i > 0) {
        vg.globalAlpha = 0.28;
        vg.drawImage(S.frames[S.i - 1], 0, 0);
        vg.globalAlpha = 1;
        vg.globalCompositeOperation = 'multiply';
      }
      vg.drawImage(S.frames[S.i], 0, 0);
      vg.globalCompositeOperation = 'source-over';
    }
    const cur = () => S.frames[S.i];

    /* ---------- drawing ---------- */
    let last = null;
    const at = e => { const r = view.getBoundingClientRect(); return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height]; };
    function seg(a, b) {
      const g = cur().getContext('2d');
      g.lineCap = g.lineJoin = 'round';
      g.strokeStyle = S.tool === 'eraser' ? '#fff' : S.colour;
      g.lineWidth = S.tool === 'eraser' ? S.size * 3 : S.size;
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0] + 0.01, b[1]); g.stroke();
    }
    function pushUndo() {
      const u = S.undo[S.i] ||= [];
      u.push(cur().getContext('2d').getImageData(0, 0, W, H));
      if (u.length > 30) u.shift();
    }
    view.addEventListener('pointerdown', e => {
      if (S.playing || e.button > 0) return;
      e.preventDefault();
      try { view.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
      pushUndo();
      last = at(e);
      seg(last, last);
      render();
    });
    view.addEventListener('pointermove', e => {
      if (!last) return;
      const p = at(e);
      seg(last, p); last = p; render();
    });
    const endStroke = () => { if (!last) return; last = null; paintThumb(S.i); changed(); };
    view.addEventListener('pointerup', endStroke);
    view.addEventListener('pointercancel', endStroke);

    /* ---------- pages ---------- */
    function go(i) { S.i = clamp(i, 0, S.frames.length - 1); paintStrip(); render(); status(); }
    function newPage() {
      if (S.frames.length >= MAX_FRAMES) return say(`A flipbook holds ${MAX_FRAMES} pages.`);
      S.frames.splice(S.i + 1, 0, blank()); S.undo.splice(S.i + 1, 0, []);
      S.i++; thumbs = []; changed(); go(S.i);
    }
    function copyPage() {
      if (S.frames.length >= MAX_FRAMES) return say(`A flipbook holds ${MAX_FRAMES} pages.`);
      S.frames.splice(S.i + 1, 0, copyOf(cur())); S.undo.splice(S.i + 1, 0, []);
      S.i++; thumbs = []; changed(); go(S.i);
    }
    function removePage() {
      if (S.frames.length === 1) { clearPage(); return say('Cleared the only page.'); }
      S.frames.splice(S.i, 1); S.undo.splice(S.i, 1);
      S.i = Math.min(S.i, S.frames.length - 1); thumbs = []; changed(); go(S.i);
    }
    function clearPage() { pushUndo(); const g = cur().getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); paintThumb(S.i); render(); changed(); }
    function undo() {
      const u = S.undo[S.i];
      if (!u || !u.length) return say('Nothing to undo on this page.');
      cur().getContext('2d').putImageData(u.pop(), 0, 0); paintThumb(S.i); render(); changed();
    }

    /* ---------- playback ---------- */
    function play() {
      if (S.playing) return stop();
      if (S.frames.length < 2) return say('Add another page first. Press N.');
      let n = S.i;
      const tick = () => {
        n = (n + 1) % S.frames.length;
        S.i = n; render(); markStrip(); status();
        S.playing = setTimeout(tick, 1000 / S.fps);
      };
      S.playing = setTimeout(tick, 1000 / S.fps);
      playBtn.replaceChildren(icon('pause'), h('span', { text: 'Stop' }));
      playBtn.setAttribute('aria-pressed', 'true');
      render();
    }
    function stop() {
      if (!S.playing) return;
      clearTimeout(S.playing); S.playing = 0;
      playBtn.replaceChildren(icon('play'), h('span', { text: 'Play' }));
      playBtn.setAttribute('aria-pressed', 'false');
      render();
    }

    /* ---------- saving ---------- */
    async function saveGif() {
      if (S.busy) return;
      stop(); busy('Writing the GIF…');
      try {
        await new Promise(r => setTimeout(r, 30));
        const bytes = encodeGif({ width: W, height: H, loop: true,
          frames: S.frames.map(c => ({ data: frameData(c), delay: Math.round(1000 / S.fps) })) });
        const blob = new Blob([bytes], { type: 'image/gif' });
        const path = await saveBlob(api, 'Flipbook', `${api.vfs.HOME}/Pictures/Flipbook`, 'Flipbook.gif', blob, { title: 'GIF saved', icon: 'film' });
        say(`Saved ${path.split('/').pop()} (${S.frames.length} pages, ${S.fps} a second).`);
      } catch (err) { say('Couldn’t save the GIF: ' + err.message); }
      busy(null);
    }
    async function saveVideo() {
      if (S.busy) return;
      stop();
      rec = recordCanvases(S.frames, S.fps, (i, n) => busy(`Recording the video… page ${i} of ${n}`));
      busy('Recording the video…');
      try {
        const blob = await rec.done;
        if (S.dead) return;
        if (!blob) say('This browser can’t make a video from a drawing. The GIF works everywhere.');
        else {
          const path = await saveBlob(api, 'Flipbook', `${api.vfs.HOME}/Videos`, 'Flipbook.webm', blob, { title: 'Video saved', icon: 'film' });
          say(`Saved ${path.split('/').pop()}.`);
        }
      } catch (err) { say('Couldn’t save the video: ' + err.message); }
      rec = null; busy(null);
    }
    async function savePng() {
      try {
        const blob = await blobOf(cur());
        const path = await saveBlob(api, 'Flipbook', `${api.vfs.HOME}/Pictures/Flipbook`, `Page ${S.i + 1}.png`, blob, { title: 'Page saved' });
        say(`Saved ${path.split('/').pop()}.`);
      } catch (err) { say('Couldn’t save the page: ' + err.message); }
    }

    /* ---------- the draft ---------- */
    function changed() {
      clearTimeout(draftTimer);
      draftTimer = setTimeout(saveDraft, 700);
    }
    function saveDraft() {
      if (S.dead) return;
      const frames = S.frames.map(c => c.toDataURL('image/png'));
      const size = frames.reduce((n, s) => n + s.length, 0);
      if (size > DRAFT_LIMIT) {
        if (!draftBlocked) say('This book is too big to keep as a draft. Save a GIF or video to keep it.');
        draftBlocked = true; return;
      }
      draftBlocked = false;
      store.set(KEY, { v: 1, fps: S.fps, onion: S.onion, i: S.i, frames });
    }
    async function loadDraft() {
      const d = store.get(KEY);
      if (!d || !Array.isArray(d.frames) || !d.frames.length) return;
      const out = [];
      for (const url of d.frames.slice(0, MAX_FRAMES)) {
        if (typeof url !== 'string' || !url.startsWith('data:image/png')) continue;
        try {
          const img = new Image(); img.src = url; await img.decode();
          const c = blank(); c.getContext('2d').drawImage(img, 0, 0, W, H); out.push(c);
        } catch (e) { /* a damaged page is skipped */ }
      }
      if (S.dead || !out.length) return;
      S.frames = out; S.undo = out.map(() => []);
      S.fps = clamp(Math.round(d.fps) || 8, 1, 24); S.onion = d.onion !== false; S.i = clamp(d.i | 0, 0, out.length - 1);
      fpsIn.value = String(S.fps); fpsOut.textContent = `${S.fps} a second`; onionBtn.setAttribute('aria-pressed', String(S.onion));
      thumbs = []; go(S.i); say('Your draft is back.');
    }

    /* ---------- the window ---------- */
    const msg = h('small.mk-msg', { role: 'status', 'aria-live': 'polite' });
    const stat = h('span.mk-stat');
    function say(t) { S.msg = t; msg.textContent = t; }
    function status() { stat.textContent = `Page ${S.i + 1} of ${S.frames.length}`; }
    function busy(t) {
      S.busy = t; msg.textContent = t || S.msg;
      for (const b of [gifBtn, vidBtn]) b.disabled = !!t;
    }
    const btn = (label, ic, fn, extra = {}) => h('button.btn.btn--sm', { type: 'button', onclick: fn, ...extra }, ic ? icon(ic) : null, h('span', { text: label }));

    const playBtn = btn('Play', 'play', play, { 'aria-pressed': 'false', title: 'Play (Space)' });
    const onionBtn = btn('Onion skin', 'layers', () => { S.onion = !S.onion; onionBtn.setAttribute('aria-pressed', String(S.onion)); render(); changed(); }, { 'aria-pressed': 'true', title: 'Show the page before, faintly (O)' });
    const penBtn = btn('Pen', null, () => tool('pen'), { 'aria-pressed': 'true', title: 'Pen (B)' });
    const eraserBtn = btn('Eraser', 'eraser', () => tool('eraser'), { 'aria-pressed': 'false', title: 'Eraser (E)' });
    function tool(t) { S.tool = t; penBtn.setAttribute('aria-pressed', String(t === 'pen')); eraserBtn.setAttribute('aria-pressed', String(t === 'eraser')); }
    const gifBtn = btn('Save GIF', 'download', saveGif);
    const vidBtn = btn('Save video', 'video', saveVideo);
    const fpsOut = h('output.mk-out', { text: '8 a second' });
    const fpsIn = h('input', { type: 'range', min: '1', max: '24', value: '8', 'aria-label': 'Frames per second', oninput: e => { S.fps = +e.target.value; fpsOut.textContent = `${S.fps} a second`; if (S.playing) { stop(); play(); } changed(); } });
    const sizeIn = h('input', { type: 'range', min: '1', max: '24', value: '4', 'aria-label': 'Pen size', oninput: e => { S.size = +e.target.value; } });
    const swatches = COLOURS.map(c => h('button.mk-sw', { type: 'button', style: { background: c }, 'aria-label': `Colour ${c}`, 'aria-pressed': String(c === S.colour),
      onclick: () => { S.colour = c; tool('pen'); swatches.forEach(s => s.setAttribute('aria-pressed', String(s.dataset.c === c))); picker.value = c; }, dataset: { c } }));
    const picker = h('input', { type: 'color', value: S.colour, 'aria-label': 'Pick any colour', oninput: e => { S.colour = e.target.value; tool('pen'); swatches.forEach(s => s.setAttribute('aria-pressed', 'false')); } });

    const strip = h('div.mk-strip', { role: 'listbox', 'aria-label': 'Pages' });
    function paintThumb(i) {
      const t = thumbs[i]; if (!t) return;
      t.getContext('2d').drawImage(S.frames[i], 0, 0, t.width, t.height);
    }
    function markStrip() {
      [...strip.children].forEach((b, i) => { b.setAttribute('aria-selected', String(i === S.i)); b.classList.toggle('is-on', i === S.i); });
      strip.children[S.i]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
    function paintStrip() {
      if (thumbs.length !== S.frames.length) {
        thumbs = S.frames.map(() => h('canvas', { width: 96, height: 64 }));
        strip.replaceChildren(...thumbs.map((t, i) => h('button.mk-thumb', { type: 'button', role: 'option', 'aria-label': `Page ${i + 1} of ${S.frames.length}`, onclick: () => { stop(); go(i); } }, t, h('i', { text: String(i + 1) }))));
        thumbs.forEach((_, i) => paintThumb(i));
      }
      markStrip();
    }

    root.classList.add('mk');
    root.replaceChildren(
      h('div.mk-bar',
        btn('New page', 'plus', newPage, { title: 'New page after this one (N)' }), btn('Copy page', 'copy', copyPage, { title: 'Copy this page (D)' }),
        btn('Delete page', 'trash', removePage, { title: 'Remove this page (Delete)' }), btn('Clear', 'x', clearPage), btn('Undo', 'undo', undo, { title: 'Undo a stroke (Ctrl+Z)' }),
        h('span.mk-grow'), playBtn, h('label.mk-lbl', 'Speed', fpsIn, fpsOut)),
      h('div.mk-main',
        h('div.mk-stage', h('div.mk-paper', view), h('div.mk-nav', btn('Back', 'chevron-left', () => { stop(); go(S.i - 1); }, { title: 'Previous page (,)' }), stat, btn('Next', 'chevron-right', () => { stop(); go(S.i + 1); }, { title: 'Next page (.)' }))),
        h('div.mk-side',
          h('div.mk-group', h('b.label', { text: 'Draw' }), h('div.mk-row', penBtn, eraserBtn), h('div.mk-row', ...swatches, picker), h('label.mk-lbl', 'Size', sizeIn), onionBtn),
          h('div.mk-group', h('b.label', { text: 'Save' }), gifBtn, vidBtn, btn('This page as PNG', 'image', savePng), msg))),
      strip);

    const onKey = e => {
      if (!win.el.classList.contains('is-active')) return;
      const t = document.activeElement, tag = t && t.tagName;
      if (tag === 'INPUT' && t.type !== 'range' && t.type !== 'color') return;
      if (tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); return undo(); }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === ',') go(S.i - 1);
      else if (k === '.') go(S.i + 1);
      else if (k === 'n') newPage();
      else if (k === 'd') copyPage();
      else if (k === 'o') onionBtn.click();
      else if (k === 'b') tool('pen');
      else if (k === 'e') tool('eraser');
      else if (e.key === 'Delete') removePage();
      else if (e.key === ' ' && tag !== 'BUTTON') play();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);

    paintStrip(); render(); status();
    loadDraft();

    return () => {
      S.dead = true;
      stop(); clearTimeout(draftTimer);
      if (rec) rec.cancel();
      window.removeEventListener('keydown', onKey);
    };
  },
});
