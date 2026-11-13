/* ============================================================
   lens.js — Lens: select part of your screen, ask anything.

   Three ways in, all ending in the same "AI Overview" answer:

   · Share a screen or window (getDisplayMedia), then Snip: the
     current frame freezes full-window and you drag around the part
     you mean. The browser asks permission and shows its own
     "sharing" bar — a web page cannot look at the screen any other
     way, and Lens does not pretend otherwise.
   · Pop out: a small always-on-top window (Document Picture-in-
     Picture) with a Snip button, so you can snip while another app
     is in front — the closest a page gets to a system-wide hotkey.
   · Paste or drop a screenshot from the computer's own snip tool.
     This is the path that works even where screen sharing is turned
     off by an administrator.

   The region is read into text IN THE BROWSER (ocr.js). Only that
   text plus the question goes to the model (llm.js) — the image is
   never uploaded. With no selection, Lens is simply ask-anything.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as LLM from '../portal/llm.js';
import * as OCR from '../portal/ocr.js';
import { render as md } from '../portal/mdlite.js';
import { store } from '../core/store.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-lens-css')) {
  const l = document.createElement('link');
  l.id = 'feat-lens-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-lens.css';
  document.head.appendChild(l);
}

const SYSTEM = [
  'You are Lens, the answer engine inside StaticOS.',
  'The user may attach text captured from their screen with OCR. OCR makes mistakes',
  '(swapped letters, lost symbols, broken lines) — quietly infer what was meant.',
  'Lead with the direct answer in the first sentence. If the text is a question or a',
  'problem, solve it and state the final answer clearly, then show brief steps.',
  'Otherwise explain what it is and what matters about it.',
  'Keep it tight: short paragraphs and bullet points; **bold** the key result.',
  'No LaTeX — write math with plain symbols (×, ÷, ², √, π, ≤).',
  'If the answer depends on a picture or diagram you cannot see, say what is missing.',
].join(' ');

const DEFAULT_Q = 'What is this? If it is a question or problem, answer it.';
const FOLLOW_UPS = ['Explain it simpler', 'Show the steps', 'Give me an example', 'Make it shorter'];
const STARTERS = [
  'Explain photosynthesis simply',
  'Solve 3x + 7 = 22',
  'Summarize the causes of World War I',
  'How do I find the area of a circle?',
];
const HISTORY_TURNS = 4;

/* one click each; every one is a real prompt, sent with the text read from the selection */
const QUICK = [
  { id: 'explain', label: 'Explain', q: 'Explain this clearly, as if to a student seeing it for the first time.' },
  { id: 'summarise', label: 'Summarise', q: 'Summarise this in a few short bullet points.' },
  { id: 'translate', label: 'Translate', q: 'Translate this into English. If it is already English, translate it into Spanish. Say which language it was written in.' },
  { id: 'solve', label: 'Solve step by step', q: 'Solve this step by step. Number each step, then state the final answer.' },
  { id: 'define', label: 'Define', q: 'Define the key terms in this, one short definition each.' },
];
/* what to try when the free service fails, by error code */
const HINTS = {
  offline: 'Check your connection, then Retry. Copy text above still works without the AI.',
  busy: 'Wait a few seconds and press Retry. Copy text above still works without the AI.',
  http: 'The free service may be down. Press Retry in a moment. Copy text above still works without the AI.',
  empty: 'Press Retry, or rephrase the question.',
};

/* history: this device only, text and answers only (never the picture) */
const HKEY = 'lens.history';
const HMAX = 30;
const cut = (t, n) => String(t || '').slice(0, n);
const histList = () => { const v = store.get(HKEY); return Array.isArray(v) ? v : []; };

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* the computer's own region-snip shortcut, so the paste path is one step */
function nativeSnip() {
  const ua = navigator.userAgent;
  if (/CrOS/.test(ua)) return { keys: 'Ctrl + Shift + Show windows', paste: 'Ctrl + V' };
  if (/Windows/.test(ua)) return { keys: 'Win + Shift + S', paste: 'Ctrl + V' };
  if (/Mac/.test(ua)) return { keys: '⌘ + Ctrl + Shift + 4', paste: '⌘ + V' };
  return { keys: 'your screenshot tool', paste: 'Ctrl + V' };
}

const canPiP = () => typeof window !== 'undefined' && 'documentPictureInPicture' in window;
const canShare = () => !!navigator.mediaDevices?.getDisplayMedia;

/* ---------- canvases ------------------------------------------------ */

function crop(src, r) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(r.w));
  c.height = Math.max(1, Math.round(r.h));
  c.getContext('2d').drawImage(src, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
  return c;
}

async function blobToCanvas(blob) {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  bmp.close?.();
  return c;
}

const toUrl = canvas => new Promise(res =>
  canvas.toBlob(b => res(b ? URL.createObjectURL(b) : ''), 'image/png'));

/* Copy the shell's styles and theme into a Picture-in-Picture document, so
   the floating window is dressed exactly like the rest of StaticOS. */
function cloneLook(doc) {
  for (const sheet of document.styleSheets) {
    try {
      if (sheet.href) {
        const l = doc.createElement('link');
        l.rel = 'stylesheet';
        l.href = sheet.href;
        doc.head.appendChild(l);
      } else {
        const s = doc.createElement('style');
        s.textContent = [...sheet.cssRules].map(r => r.cssText).join('\n');
        doc.head.appendChild(s);
      }
    } catch (err) { /* a cross-origin sheet (fonts) — its <link> is enough */ }
  }
  for (const a of document.documentElement.attributes) doc.documentElement.setAttribute(a.name, a.value);
}

/* ---------- the region picker ---------------------------------------
   Full-window freeze-frame; drag a box. Resolves to a crop rectangle in
   SOURCE pixels, or null when cancelled. Works in the main window or the
   PiP window — `win` is whichever one it is mounted in. */
function pickRegion(h, frameUrl, fw, fh, win) {
  return new Promise(resolve => {
    const doc = win.document;
    const box = h('div.lsel__box');
    const img = h('img.lsel__img', { src: frameUrl, alt: '', draggable: 'false' });
    const stage = h('div.lsel__stage', img, h('div.lsel__dim'), box);
    const done = r => { cleanup(); resolve(r); };
    const hint = h('div.lsel__hint',
      h('span', { text: 'Drag around what you want to ask about' }),
      h('button.lsel__btn', { type: 'button', text: 'Whole screen', onclick: e => { e.stopPropagation(); done({ x: 0, y: 0, w: fw, h: fh }); } }),
      h('button.lsel__btn', { type: 'button', text: 'Cancel', onclick: e => { e.stopPropagation(); done(null); } }));
    const layer = h('div.lsel', { role: 'dialog', 'aria-label': 'Select a region' }, stage, hint);
    doc.body.appendChild(layer);

    let scale = 1;
    const fit = () => {
      const W = win.innerWidth, H = win.innerHeight;
      scale = Math.min(W / fw, H / fh);
      Object.assign(stage.style, {
        width: fw * scale + 'px', height: fh * scale + 'px',
        left: (W - fw * scale) / 2 + 'px', top: (H - fh * scale) / 2 + 'px',
      });
      box.hidden = true;
      stage.classList.remove('is-drag');
    };
    fit();

    /* A drag draws the box; it then stays, with handles, so it can be moved,
       resized or nudged with the arrow keys before it is read. */
    let sel = null;           /* { x, y, w, h } in stage pixels */
    let mode = null;          /* { kind: 'new' | 'move' | edge letters, p0, r0 } */
    const clampR = r => {
      const W = stage.clientWidth, H = stage.clientHeight;
      const w = Math.max(10, Math.min(W, r.w)), hh = Math.max(10, Math.min(H, r.h));
      return { x: Math.max(0, Math.min(W - w, r.x)), y: Math.max(0, Math.min(H - hh, r.y)), w, h: hh };
    };
    const at = e => {
      const r = stage.getBoundingClientRect();
      return { x: Math.max(0, Math.min(r.width, e.clientX - r.left)), y: Math.max(0, Math.min(r.height, e.clientY - r.top)) };
    };
    const rectOf = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
    const draw = r => {
      sel = r;
      Object.assign(box.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
    };
    const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    HANDLES.forEach(k => box.append(h('i.lsel__h.lsel__h--' + k, { 'data-h': k })));
    const readBtn = h('button.lsel__btn.lsel__btn--go', { type: 'button', text: 'Read this', disabled: true, onclick: e => { e.stopPropagation(); confirm(); } });
    hint.insertBefore(readBtn, hint.children[1]);
    hint.firstChild.textContent = 'Drag around what you want to ask about';
    const setHint = () => {
      readBtn.disabled = !sel;
      hint.firstChild.textContent = sel ? 'Drag the edges to adjust, then Read this (Enter)' : 'Drag around what you want to ask about';
    };
    function confirm() {
      if (!sel) return;
      done({ x: sel.x / scale, y: sel.y / scale, w: sel.w / scale, h: sel.h / scale });
    }
    stage.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      const p = at(e);
      const hk = e.target.dataset?.h;
      if (sel && hk) mode = { kind: hk, p0: p, r0: { ...sel } };
      else if (sel && p.x >= sel.x && p.x <= sel.x + sel.w && p.y >= sel.y && p.y <= sel.y + sel.h) mode = { kind: 'move', p0: p, r0: { ...sel } };
      else { mode = { kind: 'new', p0: p }; box.hidden = false; draw({ ...p, w: 0, h: 0 }); }
      stage.setPointerCapture(e.pointerId);
      stage.classList.add('is-drag');
    });
    stage.addEventListener('pointermove', e => {
      if (!mode) return;
      const p = at(e);
      if (mode.kind === 'new') { draw(rectOf(mode.p0, p)); return; }
      const dx = p.x - mode.p0.x, dy = p.y - mode.p0.y, r0 = mode.r0;
      if (mode.kind === 'move') { draw(clampR({ ...r0, x: r0.x + dx, y: r0.y + dy })); return; }
      let x1 = r0.x, y1 = r0.y, x2 = r0.x + r0.w, y2 = r0.y + r0.h;
      if (mode.kind.includes('w')) x1 += dx;
      if (mode.kind.includes('e')) x2 += dx;
      if (mode.kind.includes('n')) y1 += dy;
      if (mode.kind.includes('s')) y2 += dy;
      draw(clampR(rectOf({ x: x1, y: y1 }, { x: x2, y: y2 })));
    });
    stage.addEventListener('pointerup', () => {
      if (!mode) return;
      const m = mode;
      mode = null;
      stage.classList.remove('is-drag');
      if (m.kind === 'new' && (sel.w < 6 || sel.h < 6)) { sel = null; box.hidden = true; }   /* a click, not a drag */
      setHint();
    });
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); }
      else if (e.key === 'Enter') {
        if (e.target?.closest?.('.lsel__hint button')) return;       /* a focused button keeps its own Enter */
        e.preventDefault(); e.stopPropagation();
        if (sel) confirm(); else done({ x: 0, y: 0, w: fw, h: fh });
      } else if (sel && e.key.startsWith('Arrow')) {
        e.preventDefault(); e.stopPropagation();
        const d = (e.altKey ? 1 : 8) * (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1);
        const horiz = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
        draw(clampR(e.shiftKey ? { ...sel, w: sel.w + (horiz ? d : 0), h: sel.h + (horiz ? 0 : d) }
          : { ...sel, x: sel.x + (horiz ? d : 0), y: sel.y + (horiz ? 0 : d) }));
      }
    };
    win.addEventListener('keydown', onKey, true);
    const onResize = () => { fit(); sel = null; mode = null; setHint(); };
    win.addEventListener('resize', onResize);
    function cleanup() {
      win.removeEventListener('keydown', onKey, true);
      win.removeEventListener('resize', onResize);
      layer.remove();
    }
    pickRegion.cancel = () => done(null);
  });
}

/* ==================================================================== */

defineApp({
  id: 'lens',
  name: 'Lens',
  icon: 'scan',
  g1: '#ff9234', g2: '#d94407',
  category: 'Utilities',
  keywords: ['ai', 'ask', 'screen', 'snip', 'screenshot', 'select', 'answer', 'question', 'overview',
    'ocr', 'read text', 'homework', 'explain', 'google lens', 'circle to search'],
  desc: 'Select part of your screen and ask anything about it',
  pinned: true, dock: true, singleton: true,
  win: { w: 500, h: 680, minW: 380, minH: 480 },

  mount(ctx) {
    const { root, api } = ctx;
    const { h, icon, clear } = api;
    const snip = nativeSnip();

    const S = {
      stream: null, surface: '', video: null,
      pip: null, pipRefs: null,
      ctx: null,            /* { canvas, url, text, confidence, reading, pct, label, error } */
      turns: [],            /* { q, a, ctxText, pending, thinking, err, el } */
      ac: null,
      countdown: 0,
      shareNote: '',
      dead: false,
    };

    OCR.warm();

    /* ------------------------------ shell ------------------------------ */
    const srcEl = h('div.lens__src');
    const ctxEl = h('div.lens__ctx');
    const feedEl = h('div.lens__feed', { 'aria-live': 'polite' });
    const box = h('textarea.lens__input', {
      rows: '1', placeholder: 'Ask anything…', 'aria-label': 'Ask Lens',
      onkeydown: e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
      },
      oninput: () => grow(),
    });
    const sendBtn = h('button.lens__send', { type: 'button', 'aria-label': 'Ask', onclick: () => submit() }, icon('send'));
    const composer = h('div.lens__composer',
      h('div.lens__bar', box, sendBtn),
      h('div.lens__foot', { text: `Answers by ${LLM.MODEL_LABEL} (free, via ${LLM.HOST}). Screenshots stay on this device — only the text read from them is sent. It can be wrong.` }));

    const scroller = h('div.lens__scroll', srcEl, ctxEl, feedEl);
    root.appendChild(h('div.app.app--col', h('div.lens', scroller, composer)));

    function grow() {
      box.style.height = 'auto';
      box.style.height = Math.min(120, box.scrollHeight) + 'px';
    }

    /* --------------------------- capture panel -------------------------- */
    function paintSrc() {
      clear(srcEl);
      if (!S.stream) {
        srcEl.append(
          h('div.lens__hero',
            h('div.lens__heroic', icon('scan')),
            h('div.lens__herotext',
              h('div.lens__title', { text: 'Select anything on your screen' }),
              h('div.lens__sub', { text: 'Lens reads it and answers — or just ask a question below.' }))),
          h('div.lens__actions',
            canShare()
              ? h('button.btn.btn--primary', { type: 'button', onclick: startShare }, icon('crop'), h('span', { text: 'Select part of your screen' }))
              : null,
            h('button.btn', { type: 'button', onclick: pasteButton }, icon('clipboard'), h('span', { text: 'Paste screenshot' }))),
          h('div.lens__tip', { text: `Tip: snip with ${snip.keys}, then press ${snip.paste} here. You can also drop an image in.` }));
        /* native append would print a null as the text "null" */
        if (S.shareNote) srcEl.append(h('div.lens__note', { text: S.shareNote }));
        return;
      }
      const surf = S.surface === 'monitor' ? 'your screen' : S.surface === 'window' ? 'a window' : S.surface === 'browser' ? 'a tab' : 'your screen';
      const live = h('div.lens__live', S.video, h('div.lens__livetag', h('i'), h('span', { text: `Sharing ${surf}` })));
      srcEl.append(
        live,
        h('div.lens__actions',
          h('button.btn.btn--primary', { type: 'button', onclick: () => snipMain(0) }, icon('crop'), h('span', { text: 'Snip' })),
          h('button.btn', { type: 'button', disabled: S.countdown > 0, onclick: () => snipMain(3) },
            icon('clock'), h('span', { text: S.countdown > 0 ? `Snipping in ${S.countdown}…` : 'Snip in 3s' })),
          canPiP()
            ? h('button.btn', { type: 'button', onclick: popOut }, icon('picture-in-picture'), h('span', { text: S.pip ? 'Popped out' : 'Pop out' }))
            : null,
          h('button.btn.btn--ghost', { type: 'button', onclick: stopShare, 'aria-label': 'Stop sharing' }, icon('x'), h('span', { text: 'Stop' }))),
        h('div.lens__tip', {
          text: S.surface === 'monitor'
            ? `Sharing the whole screen: use Snip in 3s and switch to what you want${canPiP() ? ', or Pop out for a floating Snip button that stays on top of other apps' : ''}.`
            : 'Snip any time — the shared window is captured even when it is behind StaticOS.',
        }));
    }

    async function startShare() {
      S.shareNote = '';
      const t0 = performance.now();
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 5, max: 15 }, width: { ideal: 3840 }, height: { ideal: 2160 } },
          audio: false,
        });
        if (S.dead) { stream.getTracks().forEach(t => t.stop()); return; }
        S.stream = stream;
        const track = stream.getVideoTracks()[0];
        S.surface = track?.getSettings?.().displaySurface || '';
        track?.addEventListener('ended', () => stopShare());
        const v = h('video.lens__video', { autoplay: true, muted: true, playsinline: true, 'aria-hidden': 'true' });
        v.muted = true;
        v.srcObject = stream;
        v.play?.().catch(() => {});
        S.video = v;
      } catch (err) {
        /* an instant refusal means no picker ever appeared: policy, not the person */
        const instant = performance.now() - t0 < 400;
        S.shareNote = err.name === 'NotAllowedError'
          ? (instant
            ? `Screen sharing is turned off on this device. Snip with ${snip.keys} and press ${snip.paste} here instead.`
            : 'Sharing was cancelled.')
          : `Screen sharing failed (${err.message}). Pasting a screenshot still works.`;
      }
      paintSrc();
      paintPip();
    }

    function stopShare() {
      S.stream?.getTracks().forEach(t => t.stop());
      S.stream = null;
      S.video = null;
      S.countdown = 0;
      try { S.pip?.close(); } catch (err) { /* already closed */ }
      if (!S.dead) paintSrc();
    }

    /* one frame of the shared surface, as a canvas */
    async function grab() {
      const track = S.stream?.getVideoTracks()[0];
      if (!track || track.readyState !== 'live') throw new Error('Not sharing anything.');
      let bmp = null;
      if ('ImageCapture' in window) {
        try {
          bmp = await Promise.race([new ImageCapture(track).grabFrame(), sleep(1500).then(() => null)]);
        } catch (err) { bmp = null; }
      }
      const c = document.createElement('canvas');
      if (bmp) {
        c.width = bmp.width; c.height = bmp.height;
        c.getContext('2d').drawImage(bmp, 0, 0);
        bmp.close?.();
      } else {
        const v = S.video;
        if (!v || !v.videoWidth) throw new Error('No picture from the share yet — try again in a second.');
        c.width = v.videoWidth; c.height = v.videoHeight;
        c.getContext('2d').drawImage(v, 0, 0);
      }
      return c;
    }

    async function snipMain(delay) {
      try {
        for (S.countdown = delay; S.countdown > 0; S.countdown--) { paintSrc(); await sleep(1000); if (S.dead || !S.stream) return; }
        S.countdown = 0;
        paintSrc();
        const frame = await grab();
        await selectFrom(frame, window);
      } catch (err) {
        api.notify({ app: 'Lens', icon: 'scan', title: 'Snip failed', message: err.message });
      }
    }

    /* freeze-frame → region → context */
    async function selectFrom(frame, win) {
      const url = await toUrl(frame);
      const r = await pickRegion(h, url, frame.width, frame.height, win);
      URL.revokeObjectURL(url);
      if (!r || S.dead) return false;
      await setContext(crop(frame, r), 'Screen selection');
      return true;
    }

    /* ------------------------------ paste / drop ------------------------------ */
    const isFront = () => root.closest('.win')?.classList.contains('is-active');
    const onPaste = e => {
      if (!isFront()) return;
      const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
      if (!item) return;                         /* plain text pastes into the box as usual */
      e.preventDefault();
      const f = item.getAsFile();
      if (f) useBlob(f, 'Pasted screenshot');
    };
    document.addEventListener('paste', onPaste);

    async function pasteButton() {
      try {
        const items = await navigator.clipboard.read();
        for (const it of items) {
          const type = it.types.find(t => t.startsWith('image/'));
          if (type) { await useBlob(await it.getType(type), 'Pasted screenshot'); return; }
        }
        api.notify({ app: 'Lens', icon: 'clipboard', title: 'No image on the clipboard', message: `Snip with ${snip.keys} first, then paste.` });
      } catch (err) {
        api.notify({ app: 'Lens', icon: 'clipboard', title: `Press ${snip.paste} instead`, message: 'The browser would not let Lens read the clipboard directly, but a normal paste works.' });
      }
    }

    root.addEventListener('dragover', e => {
      if ([...(e.dataTransfer?.items || [])].some(i => i.kind === 'file')) { e.preventDefault(); root.classList.add('lens-drop'); }
    });
    root.addEventListener('dragleave', e => { if (!root.contains(e.relatedTarget)) root.classList.remove('lens-drop'); });
    root.addEventListener('drop', e => {
      root.classList.remove('lens-drop');
      const f = [...(e.dataTransfer?.files || [])].find(x => x.type.startsWith('image/'));
      if (!f) return;
      e.preventDefault();
      useBlob(f, f.name || 'Dropped image');
    });

    async function useBlob(blob, label) {
      try { await setContext(await blobToCanvas(blob), label); }
      catch (err) { api.notify({ app: 'Lens', icon: 'image', title: 'Could not open that image', message: err.message }); }
    }

    /* ------------------------------ context ------------------------------ */
    async function setContext(canvas, label) {
      if (S.ctx?.url) URL.revokeObjectURL(S.ctx.url);
      const c = { canvas, url: await toUrl(canvas), text: '', confidence: 0, reading: true, pct: 0, stage: 'Loading the text reader', label, error: '' };
      S.ctx = c;
      paintCtx();
      try {
        const out = await OCR.read(canvas, { onProgress: (p, stage) => { c.pct = p; c.stage = stage; paintProgress(); } });
        if (S.ctx !== c || S.dead) return;
        c.text = out.text;
        c.confidence = out.confidence;
      } catch (err) {
        c.error = err.message;
      }
      c.reading = false;
      if (S.ctx !== c || S.dead) return;
      paintCtx();
      if (c.text) {
        /* a question already typed goes now; otherwise the person checks the text and picks an action */
        const typed = box.value.trim();
        if (typed) { box.value = ''; grow(); ask(typed); }
        else setTimeout(() => ctxEl.querySelector('.lens__chip--act')?.focus(), 0);
      }
    }

    let progRefs = null;
    function paintProgress() {
      if (!progRefs || !S.ctx) return;
      progRefs.fill.style.width = Math.round(S.ctx.pct * 100) + '%';
      progRefs.label.textContent = `${S.ctx.stage}… ${Math.round(S.ctx.pct * 100)}%`;
    }

    function paintCtx() {
      clear(ctxEl);
      progRefs = null;
      const c = S.ctx;
      if (!c) return;
      let status;
      if (c.reading) {
        const fill = h('i');
        const label = h('span');
        progRefs = { fill, label };
        status = h('div.lens__prog', h('div.lens__track', fill), label);
      } else if (c.error) {
        status = h('div.lens__err', { text: c.error });
      } else if (!c.text) {
        status = h('div.lens__err', { text: 'No text found there. Lens reads text only — try a larger area, or type your question.' });
      } else {
        const words = c.text.split(/\s+/).filter(Boolean).length;
        const edit = h('textarea.lens__ocr', { rows: '4', 'aria-label': 'Text Lens read (you can fix it)', oninput: e => { c.text = e.target.value; } });
        edit.value = c.text;
        status = h('div',
          h('details.lens__read', { open: '' },
            h('summary', { text: c.confidence ? `Read ${words} word${words === 1 ? '' : 's'} · ${c.confidence}% sure — check or fix before asking` : 'Text from your history — you can edit it' }),
            edit),
          h('div.lens__quick', { role: 'group', 'aria-label': 'Quick actions' },
            QUICK.map(a => h('button.lens__chip.lens__chip--act', { type: 'button', 'data-quick': a.id, text: a.label, onclick: () => ask(a.q) })),
            h('button.lens__chip.lens__chip--ghost', { type: 'button', 'data-act': 'copytext', text: 'Copy text', onclick: e => copy(c.text, e.currentTarget, 'Copied') })));
      }
      ctxEl.append(h('div.lens__card',
        c.url ? h('div.lens__thumb', h('img', { src: c.url, alt: 'Your selection' })) : null,
        h('div.lens__meta',
          h('div.lens__row',
            h('b', { text: c.label }),
            h('span.lens__spacer'),
            S.stream ? h('button.lens__icbtn', { type: 'button', title: 'Snip again', 'aria-label': 'Snip again', onclick: () => snipMain(0) }, icon('scan')) : null,
            c.canvas ? h('button.lens__icbtn', { type: 'button', title: 'Crop tighter', 'aria-label': 'Crop tighter', onclick: recrop }, icon('crop')) : null,
            h('button.lens__icbtn', { type: 'button', title: 'Remove', 'aria-label': 'Remove selection', onclick: () => { if (S.ctx?.url) URL.revokeObjectURL(S.ctx.url); S.ctx = null; paintCtx(); } }, icon('x'))),
          status)));
      paintProgress();
      box.placeholder = c.text ? 'Ask about your selection…' : 'Ask anything…';
    }

    async function recrop() {
      if (!S.ctx) return;
      const src = S.ctx.canvas;
      const url = await toUrl(src);
      const r = await pickRegion(h, url, src.width, src.height, window);
      URL.revokeObjectURL(url);
      if (r) await setContext(crop(src, r), S.ctx?.label || 'Selection');
    }

    /* ------------------------------ asking ------------------------------ */
    function submit(text) {
      let q = String(text ?? box.value).trim();
      if (!q && text === undefined && S.ctx?.text) q = DEFAULT_Q;     /* Enter on a read selection = "what is this?" */
      if (!q) return;
      if (text === undefined) { box.value = ''; grow(); }
      ask(q);
    }

    function history() {
      const done = S.turns.filter(t => !t.pending && !t.err && t.a).slice(-HISTORY_TURNS);
      return done.flatMap(t => [{ role: 'user', content: userContent(t) }, { role: 'assistant', content: t.a }]);
    }
    const userContent = t => (t.ctxText
      ? `Text from my screen (OCR):\n"""\n${t.ctxText}\n"""\n\n${t.q}`
      : t.q);

    async function ask(q, keep) {
      S.ac?.abort();
      const ac = new AbortController();
      S.ac = ac;
      /* attach the selection unless the conversation already carries it */
      const lastCtx = [...S.turns].reverse().find(t => t.ctxText)?.ctxText || '';
      const ctxText = keep !== undefined ? keep : (S.ctx?.text && S.ctx.text !== lastCtx ? S.ctx.text : '');
      const turn = { q, a: '', ctxText, pending: true, thinking: false, err: '', el: null };
      const messages = [{ role: 'system', content: SYSTEM }, ...history(), { role: 'user', content: userContent(turn) }];
      S.turns.push(turn);
      paintFeed();
      try {
        await LLM.stream(messages, {
          signal: ac.signal,
          onThink: () => { if (!turn.thinking) { turn.thinking = true; paintTurn(turn); } },
          onText: t => { turn.a = t; paintTurn(turn); },
        });
      } catch (err) {
        turn.err = err.name === 'AbortError' ? 'Stopped.' : `${err.message} ${HINTS[err.code] || 'Press Retry.'}`;
        turn.stopped = err.name === 'AbortError';
      }
      if (!turn.err && turn.a) remember(turn);
      turn.pending = false;
      if (S.ac === ac) S.ac = null;
      if (S.dead) return;
      paintFeed();
    }

    let paintQueued = new Set();
    function paintTurn(turn) {
      paintQueued.add(turn);
      if (paintQueued.size > 1) return;
      requestAnimationFrame(() => {
        for (const t of paintQueued) fillTurn(t);
        paintQueued = new Set();
      });
    }

    function fillTurn(t) {
      if (!t.el) return;
      const body = t.el.querySelector('.lens-a__body');
      clear(body);
      if (t.err) body.append(h('div.lens__err', { text: t.err }));
      else if (t.a) body.append(md(t.a));
      else body.append(h('div.lens-a__wait', h('i'), h('i'), h('i'), h('span', { text: t.thinking ? 'Thinking' : 'Asking' })));
      if (t.pending && t.a) body.append(h('span.lens-a__caret'));
      if (S.pipRefs?.turn === t) fillPipAnswer();
      if (t === S.turns[S.turns.length - 1]) feedEl.lastElementChild?.scrollIntoView?.({ block: 'end' });
    }

    function paintFeed() {
      clear(feedEl);
      if (!S.turns.length) {
        feedEl.append(...[S.ctx?.text ? null : h('div.lens__starters',
          h('div.lens__cap', { text: 'Try asking' }),
          h('div.lens__chips', STARTERS.map(s => h('button.lens__chip', { type: 'button', text: s, onclick: () => submit(s) })))), histEl()].filter(Boolean));
        paintPip();
        return;
      }
      S.turns.forEach((t, i) => {
        const last = i === S.turns.length - 1;
        t.el = h('div.lens-a',
          h('div.lens-a__head',
            h('span.lens-a__spark', icon('sparkles')),
            h('b', { text: 'AI Overview' }),
            h('span.lens__spacer'),
            t.pending
              ? h('button.lens__icbtn', { type: 'button', title: 'Stop', 'aria-label': 'Stop', onclick: () => S.ac?.abort() }, icon('square'))
              : h('button.lens__icbtn', { type: 'button', title: 'Copy answer', 'aria-label': 'Copy answer', onclick: e => copy(t.a, e.currentTarget) }, icon('copy'))),
          h('div.lens-a__body'),
          !t.pending && !t.err && t.a ? h('div.lens__hnote', { text: 'Text reading and the AI can both be wrong — check anything that matters.' }) : null,
          !t.pending && last && !t.err
            ? h('div.lens__chips.lens__chips--follow', FOLLOW_UPS.map(s => h('button.lens__chip', { type: 'button', text: s, onclick: () => submit(s) })),
              h('button.lens__chip.lens__chip--ghost', { type: 'button', text: 'Retry', 'data-act': 'retry', onclick: () => retry(t) }))
            : null,
          !t.pending && t.err
            ? h('div.lens__chips.lens__chips--follow', h('button.lens__chip', { type: 'button', text: 'Retry', 'data-act': 'retry', onclick: () => retry(t) }))
            : null);
        feedEl.append(
          h('div.lens-q', t.ctxText ? h('span.lens-q__tag', icon('crop')) : null, h('span', { text: t.q === DEFAULT_Q ? 'What is this?' : t.q })),
          t.el);
        fillTurn(t);
      });
      paintPip();
    }

    function retry(t) {
      const i = S.turns.indexOf(t);
      if (i < 0) return;
      S.turns.splice(i, 1);
      ask(t.q, t.ctxText);
    }

    /* ---- history: saved through the store, capped, deletable ---- */
    function remember(t) {
      const e = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ts: Date.now(), ctx: cut(t.ctxText || lastCtxOf(t), 4000), q: cut(t.q, 500), a: cut(t.a, 6000) };
      store.set(HKEY, [e, ...histList()].slice(0, HMAX));
      t.hid = e.id;
    }
    const lastCtxOf = t => { for (let i = S.turns.indexOf(t); i >= 0; i--) if (S.turns[i].ctxText) return S.turns[i].ctxText; return ''; };
    function histEl() {
      const list = histList();
      if (!list.length) return null;
      const reopen = e => {
        S.ctx = e.ctx ? { canvas: null, url: '', text: e.ctx, confidence: 0, reading: false, label: 'From history', error: '' } : null;
        S.turns = [{ q: e.q, a: e.a, ctxText: e.ctx, pending: false, thinking: false, err: '', el: null, hid: e.id }];
        paintCtx(); paintFeed();
      };
      const when = ts => new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      return h('details.lens__hist', { 'data-hist': '' },
        h('summary', { text: `Recent on this device (${list.length})` }),
        list.map(e => h('div.lens__hrow',
          h('button.lens__hopen', { type: 'button', onclick: () => reopen(e) },
            h('b', { text: e.q === DEFAULT_Q ? 'What is this?' : e.q }), h('small', { text: `${when(e.ts)} · ${e.ctx ? cut(e.ctx, 60) : 'no selection'}` })),
          h('button.lens__icbtn', { type: 'button', title: 'Delete this one', 'aria-label': 'Delete this history item', onclick: () => { store.set(HKEY, histList().filter(x => x.id !== e.id)); paintFeed(); } }, icon('trash')))),
        h('div.lens__hrow',
          h('button.lens__chip', { type: 'button', text: 'Clear all history', onclick: () => { store.set(HKEY, []); paintFeed(); } })),
        h('div.lens__hnote', { text: 'Only the text read from your selection, your question and the answer are kept here, on this device. Pictures are never saved.' }));
    }

    async function copy(text, btn, done) {
      try {
        await navigator.clipboard.writeText(text);
        btn.classList.add('is-done');
        const was = btn.textContent;
        if (done && !btn.querySelector('svg')) btn.textContent = done;
        setTimeout(() => { btn.classList.remove('is-done'); if (done && !btn.querySelector('svg')) btn.textContent = was; }, 1200);
      } catch (err) { /* clipboard refused — nothing to do */ }
    }

    /* ------------------------------ pop out ------------------------------ */
    async function popOut() {
      if (S.pip) { try { S.pip.focus(); } catch (err) {} return; }
      let pip;
      try { pip = await window.documentPictureInPicture.requestWindow({ width: 340, height: 420 }); }
      catch (err) { api.notify({ app: 'Lens', icon: 'scan', title: 'Pop out failed', message: err.message }); return; }
      S.pip = pip;
      cloneLook(pip.document);
      pip.document.body.className = 'lens-pipbody';
      pip.addEventListener('pagehide', () => { S.pip = null; S.pipRefs = null; if (!S.dead) paintSrc(); });
      paintSrc();
      paintPip();
    }

    function paintPip() {
      const pip = S.pip;
      if (!pip) return;
      const body = pip.document.body;
      if (body.querySelector('.lsel')) return;          /* mid-selection: leave it */
      body.replaceChildren();
      const turn = S.turns[S.turns.length - 1] || null;
      const answer = h('div.lens-pip__answer');
      const input = h('input.lens-pip__input', {
        type: 'text', placeholder: 'Ask anything…', 'aria-label': 'Ask Lens',
        onkeydown: e => { if (e.key === 'Enter' && e.target.value.trim()) { const v = e.target.value; e.target.value = ''; submit(v); } },
      });
      S.pipRefs = { turn, answer };
      body.append(h('div.lens-pip',
        h('div.lens-pip__head', h('span.lens-pip__ic', icon('scan')), h('b', { text: 'Lens' }),
          h('span.lens__spacer'), h('small', { text: S.stream ? 'sharing' : 'not sharing' })),
        h('button.btn.btn--primary.lens-pip__snip', { type: 'button', disabled: !S.stream, onclick: snipPip },
          icon('crop'), h('span', { text: S.stream ? 'Snip' : 'Share your screen first' })),
        answer,
        input));
      fillPipAnswer();
    }

    function fillPipAnswer() {
      const r = S.pipRefs;
      if (!r) return;
      const t = r.turn;
      r.answer.replaceChildren();
      if (!t) { r.answer.append(h('div.lens-pip__empty', { text: 'Snip anything on screen — the answer shows up here.' })); return; }
      if (t.err) r.answer.append(h('div.lens__err', { text: t.err }));
      else if (t.a) r.answer.append(md(t.a));
      else r.answer.append(h('div.lens-a__wait', h('i'), h('i'), h('i'), h('span', { text: t.thinking ? 'Thinking' : 'Asking' })));
      if (S.ctx?.reading) r.answer.replaceChildren(h('div.lens-a__wait', h('i'), h('i'), h('i'), h('span', { text: 'Reading your selection' })));
    }

    /* The floating window grabs the frame FIRST (so it is not in the way),
       then grows to give room to drag, then shrinks back. resizeTo needs a
       click in that window — the Snip press and the drag release are both. */
    async function snipPip() {
      const pip = S.pip;
      if (!pip) return;
      const size = [pip.outerWidth, pip.outerHeight];
      try {
        const frame = await grab();
        try { pip.resizeTo(Math.min(screen.availWidth - 60, 1200), Math.min(screen.availHeight - 60, 760)); } catch (err) {}
        await sleep(120);
        const url = await toUrl(frame);
        const r = await pickRegion(h, url, frame.width, frame.height, pip);
        URL.revokeObjectURL(url);
        try { pip.resizeTo(size[0], size[1]); } catch (err) {}
        if (!r || S.dead) { paintPip(); return; }
        paintPip();
        fillPipAnswer();
        await setContext(crop(frame, r), 'Screen selection');
      } catch (err) {
        try { pip.resizeTo(size[0], size[1]); } catch (e) {}
        paintPip();
        S.pipRefs?.answer.replaceChildren(h('div.lens__err', { text: err.message }));
      }
    }

    /* ------------------------------ lifecycle ------------------------------ */
    paintSrc();
    paintCtx();
    paintFeed();
    setTimeout(() => box.focus(), 60);

    root.cherriTeardown = () => {
      if (S.dead) return;
      S.dead = true;
      S.ac?.abort();
      pickRegion.cancel?.();
      document.removeEventListener('paste', onPaste);
      S.stream?.getTracks().forEach(t => t.stop());
      try { S.pip?.close(); } catch (err) {}
      if (S.ctx?.url) URL.revokeObjectURL(S.ctx.url);
      OCR.release();
    };
    return root.cherriTeardown;
  },
});
