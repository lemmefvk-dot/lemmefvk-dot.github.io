/* ============================================================
   Scan (Picture Tools) — photograph a page, get a clean black-and-white
   PDF.

   1. Get a page: take a photo with the camera, or choose a picture
      (from ~/Pictures or from this computer).
   2. The page's edges are found by themselves. Drag the four corners
      (or focus one and use the arrow keys) until they sit on the
      page's corners; Rotate turns the picture a quarter.
   3. The page is straightened (perspective correction) and cleaned up
      with an adaptive black-and-white threshold, so a shadow or an
      uneven lamp doesn't turn half the page black. The side shows the
      result as it will print; "Detail" trades cleanliness for faint
      pencil.
   4. Add page — as many as you like, reorder or remove them — then
      Save PDF to ~/Documents/Scans (a real file) or Download it.
      Pick several pictures and "Add the picked pictures as pages" makes
      a page of each, one after the other, with their edges found for you.

   The page can be black and white (the default), grey or colour. Grey
   and colour keep the paper's own shading, with a Brightness control to
   lift a dim photo. The sheet can be left as the page's own shape, or
   made A4 or Letter: the page is straightened to that shape and the PDF
   page is that size.

   All of it happens on this device: no picture, page or PDF is ever
   sent anywhere. The camera is let go the moment a photo is taken,
   when another tab is opened and when the window closes.
   The maths is js/core/docscan.js; the PDF is js/core/pdfwrite.js.
   ============================================================ */
import { toGray, detectCorners, defaultCorners, orderCorners, outputSize, warpGray, warpRGBA, binarize, pack1bit } from '../core/docscan.js';
import { makePdf } from '../core/pdfwrite.js';
import { openCamera, cameraProblem, stopStream } from '../core/scancam.js';
import { pickerView, blobOfSource, bitmapOf, sizeOfBitmap, sourceOfPath, clamp, encode } from './pt-common.js';
import * as media from '../core/media.js';
import vfs from '../core/vfs.js';
import { t } from '../core/i18n.js';

const WORK = 2000;               /* longest side the page is worked on at */
const PREVIEW = 520;
const FINAL = 1800;              /* longest side of a saved page: about 200 dpi on A4 */
export const MODES = [['bw', 'Black & white'], ['gray', 'Grey'], ['color', 'Colour']];
export const PAPERS = [['auto', 'The page’s own shape'], ['a4', 'A4 (210 × 297 mm)'], ['letter', 'Letter (8.5 × 11 in)']];
const SHEET_RATIO = { a4: 842 / 595, letter: 792 / 612 };     /* long side over short side */
const CORNER = ['Top left', 'Top right', 'Bottom right', 'Bottom left'];
const pad2 = n => String(n).padStart(2, '0');
export const scanName = (d = new Date()) => `Scan ${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}.${pad2(d.getMinutes())}.pdf`;
export const scansDir = () => `${vfs.HOME}/Documents/Scans`;

export function mountScan({ api, root, opts }) {
  const { h, icon } = api;
  const S = {
    alive: true, stream: null, camGen: 0, src: null, corners: null, found: false, detail: 0.5,
    mode: 'bw', boost: 0, paper: 'auto', picked: [],
    pages: [], pvTimer: 0, pvSeq: 0, busy: false, last: null,
  };
  const fmtBytes = api.fmt.fmtBytes;

  /* ---------- stage: camera, or the page with its four corners ---------- */
  const video = h('video.pt-scan__video', { muted: true, playsinline: true, autoplay: true, 'aria-label': t('What the camera sees') });
  video.muted = true;
  const canvas = h('canvas.pt-scan__canvas', { role: 'img', 'aria-label': t('The picture, with the page outlined') });
  const outline = h('svg.pt-scan__outline', { 'aria-hidden': 'true', preserveAspectRatio: 'none' });
  outline.append(h('polygon.pt-scan__poly'));
  const handles = CORNER.map((name, i) => h('button.pt-scan__handle', {
    type: 'button', 'aria-label': t('{name} corner. Drag it, or use the arrow keys.', { name }), dataset: { corner: String(i), fk: `scan-corner-${i}` },
    onpointerdown: e => dragStart(e, i), onkeydown: e => nudge(e, i),
  }));
  const wrap = h('div.pt-scan__wrap', canvas, outline, ...handles);
  const shutter = h('button.btn.btn--primary.pt-scan__shutter', { type: 'button', dataset: { fk: 'scan-shoot' }, onclick: () => shoot() }, icon('camera'), h('span', { text: t('Take the photo') }));
  const cancelCam = h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'scan-cancel' }, onclick: () => { releaseCamera(); paintStage(); } }, t('Cancel'));
  const camView = h('div.pt-scan__cam', video, h('div.pt-scan__camBar', shutter, cancelCam));
  const empty = h('div.pt__empty.pt-scan__empty', icon('file-text'), h('b', { text: t('Photograph or choose a page') }),
    h('small', { text: t('Lay the page flat on a table with some light. The edges are found for you, and you can drag the corners to fix them.') }));
  const problem = h('div.pt__empty.pt-scan__problem', { hidden: true, role: 'alert' });
  const stage = h('div.pt__stage.pt-scan__stage', empty, problem, camView, wrap);
  const foot = h('div.pt__foot', { role: 'status', 'aria-live': 'polite' });
  const say = t => { foot.textContent = t; };

  /* ---------- the side ---------- */
  const camBtn = h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: 'scan-camera' }, onclick: () => startCamera() }, icon('camera'), h('span', { text: t('Take a photo') }));
  const picker = pickerView(api, { multi: true, label: t('Pictures to scan'), onChange: (list, src, added) => {
    S.picked = list;
    paintPicked();
    if (added && list.length) loadSource(src);
  } });
  const manyBtn = h('button.btn.btn--sm', { type: 'button', hidden: true, dataset: { fk: 'scan-many' }, onclick: () => addPicked() }, icon('layers'), h('span', { text: t('Add the picked pictures as pages') }));
  const findBtn = h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'scan-find' }, onclick: () => findEdges() }, icon('crop'), h('span', { text: t('Find edges') }));
  const rotBtn = h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'scan-rotate' }, onclick: () => rotate() }, icon('rotate-ccw'), h('span', { text: t('Rotate') }));
  const detailIn = h('input', { type: 'range', min: '0', max: '100', step: '5', value: '50', 'aria-label': t('Detail'), dataset: { fk: 'scan-detail' },
    oninput: () => { S.detail = Number(detailIn.value) / 100; schedulePreview(); } });
  const modeBtns = MODES.map(([id, label]) => h('button.pt__segbtn', { type: 'button', role: 'radio', 'aria-checked': String(id === S.mode), dataset: { v: id, fk: `scan-mode-${id}` },
    onclick: () => { S.mode = id; for (const b of modeBtns) b.setAttribute('aria-checked', String(b.dataset.v === id)); paintModeBits(); schedulePreview(true); } }, label));
  const modeSeg = h('div.pt__seg', { role: 'radiogroup', 'aria-label': t('Colour of the page') }, modeBtns);
  const paperSel = h('select', { 'aria-label': t('Page size'), dataset: { fk: 'scan-paper' }, onchange: () => { S.paper = paperSel.value; schedulePreview(true); } },
    PAPERS.map(([id, label]) => h('option', { value: id, text: label })));
  const boostOut = h('output', { text: '0' });
  const boostIn = h('input', { type: 'range', min: '-50', max: '50', step: '5', value: '0', 'aria-label': t('Brightness'), dataset: { fk: 'scan-boost' },
    oninput: () => { S.boost = Number(boostIn.value); boostOut.textContent = (S.boost > 0 ? '+' : '') + S.boost; schedulePreview(); } });
  const boostRow = h('label.pt__slider', { hidden: true }, h('span', { text: t('Brightness') }), boostIn, boostOut);
  const detailRow = h('label.pt__slider', h('span', { text: t('Detail') }), detailIn);
  function paintModeBits() { boostRow.hidden = S.mode === 'bw'; detailRow.hidden = S.mode !== 'bw'; }
  const preview = h('canvas.pt-scan__preview', { role: 'img', 'aria-label': t('The page as it will be saved') });
  const previewEmpty = h('small.pt__hint', { text: t('The cleaned-up page shows here.') });
  const addBtn = h('button.btn.btn--sm.btn--primary', { type: 'button', disabled: true, dataset: { fk: 'scan-add' }, onclick: () => addPage() }, icon('plus'), h('span', { text: t('Add page') }));
  const list = h('div.pt-scan__pages', { role: 'list', 'aria-label': t('Pages') });
  const pagesLabel = h('div.pt__label', { text: t('Pages') });
  const saveBtn = h('button.btn.btn--sm.btn--primary', { type: 'button', disabled: true, dataset: { fk: 'scan-save' }, onclick: () => save() }, icon('save'), h('span', { text: t('Save PDF') }));
  const dlBtn = h('button.btn.btn--sm', { type: 'button', disabled: true, dataset: { fk: 'scan-download' }, onclick: () => download() }, icon('download'), h('span', { text: t('Download') }));
  const resetBtn = h('button.btn.btn--sm', { type: 'button', disabled: true, dataset: { fk: 'scan-reset' }, onclick: () => { S.pages = []; paintPages(); say('Started over.'); } }, icon('trash'), h('span', { text: t('Start over') }));
  const side = h('div.pt__side',
    h('div.pt__group', h('div.pt__label', { text: t('Get a page') }), camBtn, picker.el, manyBtn),
    h('div.pt__group', h('div.pt__label', { text: t('Edges') }), h('div.pt__actions', findBtn, rotBtn)),
    h('div.pt__group', h('div.pt__label', { text: 'Clean-up' }),
      modeSeg, h('label.pt__line', h('span', { text: t('Page size') }), paperSel), detailRow, boostRow,
      h('div.pt-scan__pv', preview, previewEmpty), addBtn),
    h('div.pt__group', pagesLabel, list, h('div.pt__actions', saveBtn, dlBtn, resetBtn),
      h('small.pt__hint', { text: t('Saved to Documents › Scans. Nothing leaves this device.') })));
  root.append(h('div.pt__split.pt-scan', h('div.pt__col', stage, foot), side));

  /* ---------- camera ---------- */
  function releaseCamera() {
    S.camGen++;
    stopStream(S.stream);
    S.stream = null;
    try { video.pause(); } catch (e) { /* nothing playing */ }
    video.srcObject = null;
  }
  async function startCamera() {
    const gen = ++S.camGen;
    stopStream(S.stream);
    S.stream = null;
    problem.hidden = true;
    say('Starting the camera…');
    let stream;
    try { stream = await openCamera({ facing: 'environment' }); } catch (err) {
      if (gen !== S.camGen || !S.alive) return;
      const p = cameraProblem(err);
      problem.replaceChildren(icon('camera'), h('b', { text: p.title }), h('small', { text: p.body }));
      problem.hidden = false;
      paintStage('problem');
      say(p.title);
      return;
    }
    if (gen !== S.camGen || !S.alive) { stopStream(stream); return; }
    S.stream = stream;
    video.srcObject = stream;
    video.play?.().catch?.(() => {});
    paintStage('camera');
    say('Frame the whole page, then press Take the photo.');
  }
  function shoot() {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!S.stream || !vw || !vh) { say('The camera isn’t ready yet.'); return; }
    const c = document.createElement('canvas');
    c.width = vw; c.height = vh;
    c.getContext('2d').drawImage(video, 0, 0, vw, vh);
    releaseCamera();                                   /* let the camera go as soon as the picture is taken */
    setSource(c);
  }

  /* ---------- the picture ---------- */
  async function loadSource(src) {
    const seq = ++S.pvSeq;
    releaseCamera();
    say('Opening the picture…');
    try {
      const bmp = await bitmapOf(await blobOfSource(src));
      if (!S.alive || seq !== S.pvSeq) { bmp.close?.(); return; }
      const { w, h: hh } = sizeOfBitmap(bmp);
      const k = Math.min(1, WORK / Math.max(w, hh));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(hh * k));
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close?.();
      setSource(c);
    } catch (err) { if (S.alive) say(`Couldn’t open that picture: ${err?.message || err}`); }
  }
  function setSource(c) {
    if (Math.max(c.width, c.height) > WORK) {          /* a 12-megapixel photo: work on a smaller copy */
      const k = WORK / Math.max(c.width, c.height);
      const s = document.createElement('canvas');
      s.width = Math.round(c.width * k); s.height = Math.round(c.height * k);
      s.getContext('2d').drawImage(c, 0, 0, s.width, s.height);
      c = s;
    }
    canvas.width = c.width; canvas.height = c.height;
    canvas.getContext('2d').drawImage(c, 0, 0);
    outline.setAttribute('viewBox', `0 0 ${c.width} ${c.height}`);
    readPixels();
    findEdges(true);
    paintStage('edit');
  }
  function readPixels() {
    const w = canvas.width, hh = canvas.height;
    const img = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, hh);
    S.src = { w, h: hh, gray: toGray(img.data, w, hh), rgba: img.data };
  }
  function findEdges(first) {
    if (!S.src) return;
    const r = detectCorners(S.src.gray, S.src.w, S.src.h);
    S.corners = r.corners.map(p => ({ ...p }));
    S.found = r.found;
    paintCorners();
    schedulePreview(true);
    say(r.found ? 'Found the page’s edges. Drag a corner if one is off.' : 'No page stood out, so the corners are just inside the picture. Drag them onto the page’s corners.');
    if (!first) addBtn.focus?.({ preventScroll: true });
  }
  function rotate() {
    if (!S.src) return;
    const { w, h: hh } = S.src;
    const c = document.createElement('canvas');
    c.width = hh; c.height = w;
    const g = c.getContext('2d');
    g.translate(hh, 0); g.rotate(Math.PI / 2);
    g.drawImage(canvas, 0, 0);
    const old = S.corners;
    canvas.width = c.width; canvas.height = c.height;
    canvas.getContext('2d').drawImage(c, 0, 0);
    outline.setAttribute('viewBox', `0 0 ${c.width} ${c.height}`);
    readPixels();
    S.corners = orderCorners(old.map(p => ({ x: hh - p.y, y: p.x })));
    paintCorners();
    schedulePreview(true);
    say('Turned a quarter.');
  }

  /* ---------- corners ---------- */
  function paintCorners() {
    if (!S.corners) return;
    const { w, h: hh } = S.src;
    S.corners.forEach((p, i) => { handles[i].style.left = `${p.x / w * 100}%`; handles[i].style.top = `${p.y / hh * 100}%`; });
    outline.firstChild.setAttribute('points', S.corners.map(p => `${p.x},${p.y}`).join(' '));
  }
  function dragStart(e, i) {
    if (e.button !== 0 || !S.src) return;
    e.preventDefault(); e.stopPropagation();
    const el = handles[i];
    el.setPointerCapture(e.pointerId);
    el.classList.add('is-drag');
    const move = ev => {
      const r = canvas.getBoundingClientRect();
      S.corners[i] = { x: clamp((ev.clientX - r.left) / r.width * S.src.w, 0, S.src.w - 1), y: clamp((ev.clientY - r.top) / r.height * S.src.h, 0, S.src.h - 1) };
      paintCorners();
      schedulePreview();
    };
    const up = () => {
      el.classList.remove('is-drag');
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      schedulePreview(true);
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  }
  function nudge(e, i) {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d || !S.src) return;
    e.preventDefault();
    const step = (e.shiftKey ? 0.02 : 0.004) * Math.max(S.src.w, S.src.h);
    const p = S.corners[i];
    S.corners[i] = { x: clamp(p.x + d[0] * step, 0, S.src.w - 1), y: clamp(p.y + d[1] * step, 0, S.src.h - 1) };
    paintCorners();
    schedulePreview();
  }

  /* ---------- the cleaned-up page ---------- */
  function convex() {
    /* a bow-tie (corners crossed over) can't be straightened */
    const c = S.corners;
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = c[i], b = c[(i + 1) % 4], d = c[(i + 2) % 4];
      const cr = (b.x - a.x) * (d.y - b.y) - (b.y - a.y) * (d.x - b.x);
      if (Math.abs(cr) < 1e-6) return false;
      if (!sign) sign = Math.sign(cr); else if (Math.sign(cr) !== sign) return false;
    }
    return true;
  }
  /* the page's pixels, straightened: { w, h, bw } for black and white, { w, h, rgba } for grey and colour */
  const lift = (v, b) => 255 * Math.pow(v / 255, Math.pow(2, -b / 50));
  function render(maxSide, src = S.src, corners = S.corners) {
    let size = outputSize(corners, maxSide);
    if (S.paper !== 'auto') {
      const long = Math.max(size.w, size.h), short = Math.max(8, Math.round(long / SHEET_RATIO[S.paper]));
      size = size.w > size.h ? { w: long, h: short } : { w: short, h: long };
    }
    if (S.mode === 'bw') {
      const gray = warpGray(src.gray, src.w, src.h, corners, size.w, size.h);
      return { w: size.w, h: size.h, bw: binarize(gray, size.w, size.h, { detail: S.detail }) };
    }
    const rgba = warpRGBA(src.rgba, src.w, src.h, corners, size.w, size.h);
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) lut[v] = lift(v, S.boost);
    for (let i = 0; i < rgba.length; i += 4) {
      let r = lut[rgba[i]], g = lut[rgba[i + 1]], b = lut[rgba[i + 2]];
      if (S.mode === 'gray') r = g = b = 0.299 * r + 0.587 * g + 0.114 * b;
      rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b;
    }
    return { w: size.w, h: size.h, rgba };
  }
  /* a page as RGBA, for the preview and the thumbnail */
  function pixelsOf(r) {
    if (r.rgba) return new ImageData(r.rgba, r.w, r.h);
    const img = new ImageData(r.w, r.h);
    for (let i = 0; i < r.bw.length; i++) { const v = r.bw[i]; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
    return img;
  }
  function schedulePreview(now) {
    clearTimeout(S.pvTimer);
    S.pvTimer = setTimeout(drawPreview, now ? 0 : 90);
  }
  function drawPreview() {
    if (!S.alive || !S.src || !S.corners) return;
    if (!convex()) { addBtn.disabled = true; previewEmpty.hidden = false; previewEmpty.textContent = 'The corners cross over. Put them back in order around the page.'; preview.hidden = true; return; }
    const r = render(PREVIEW);
    preview.width = r.w; preview.height = r.h;
    preview.getContext('2d').putImageData(pixelsOf(r), 0, 0);
    preview.hidden = false;
    previewEmpty.hidden = true;
    addBtn.disabled = false;
  }

  /* ---------- pages ---------- */
  /* one finished page from a straightened render */
  async function pageOf(r) {
    const full = document.createElement('canvas');
    full.width = r.w; full.height = r.h;
    full.getContext('2d').putImageData(pixelsOf(r), 0, 0);
    const thumb = document.createElement('canvas');
    thumb.width = 96; thumb.height = Math.max(1, Math.round(r.h * 96 / r.w));
    const tg = thumb.getContext('2d');
    tg.imageSmoothingQuality = 'high';
    tg.drawImage(full, 0, 0, thumb.width, thumb.height);
    const page = { id: `p${Date.now().toString(36)}${S.pages.length}`, width: r.w, height: r.h, kind: S.mode, paper: S.paper === 'auto' ? undefined : S.paper, thumb };
    if (r.bw) page.bits = pack1bit(r.bw, r.w, r.h);
    else if (S.mode === 'gray') {
      page.gray = new Uint8Array(r.w * r.h);
      for (let i = 0; i < page.gray.length; i++) page.gray[i] = r.rgba[i * 4];
    } else {
      const blob = await encode(full, 'image/jpeg', 0.88);
      if (!blob) throw new Error('This browser couldn’t make a JPEG for the colour page.');
      page.jpeg = new Uint8Array(await blob.arrayBuffer());
    }
    full.width = full.height = 0;
    return page;
  }
  async function addPage() {
    if (S.busy || !S.src || !S.corners || !convex()) return;
    S.busy = true;
    addBtn.disabled = true;
    say('Making the page…');
    await new Promise(r => setTimeout(r, 0));          /* let the message paint before the heavy part */
    try {
      S.pages.push(await pageOf(render(FINAL)));
      paintPages();
      /* ready for the next sheet */
      S.src = null; S.corners = null;
      picker.clear();
      S.picked = [];
      paintPicked();
      paintStage();
      preview.hidden = true; previewEmpty.hidden = false; previewEmpty.textContent = 'The cleaned-up page shows here.';
      say(`Page ${S.pages.length} added. Take or choose the next one, or save the PDF.`);
    } catch (err) {
      say(`Couldn’t make that page: ${err?.message || err}`);
      addBtn.disabled = false;
    } finally { S.busy = false; }
  }
  /* several pictures at once: each becomes a page, its edges found by themselves */
  function paintPicked() {
    manyBtn.hidden = S.picked.length < 2;
    manyBtn.querySelector('span:last-child').textContent = `Add the ${S.picked.length} picked pictures as pages`;
  }
  async function addPicked() {
    if (S.busy || S.picked.length < 2) return;
    S.busy = true;
    manyBtn.disabled = true;
    const list = S.picked.slice();
    let done = 0;
    try {
      for (const src of list) {
        if (!S.alive) return;
        say(`Making page ${done + 1} of ${list.length}…`);
        await new Promise(r => setTimeout(r, 0));
        const bmp = await bitmapOf(await blobOfSource(src));
        const { w, h: hh } = sizeOfBitmap(bmp);
        const k = Math.min(1, WORK / Math.max(w, hh));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(hh * k));
        const g = c.getContext('2d', { willReadFrequently: true });
        g.imageSmoothingQuality = 'high';
        g.drawImage(bmp, 0, 0, c.width, c.height);
        bmp.close?.();
        const img = g.getImageData(0, 0, c.width, c.height);
        const one = { w: c.width, h: c.height, gray: toGray(img.data, c.width, c.height), rgba: img.data };
        const corners = detectCorners(one.gray, one.w, one.h).corners;
        S.pages.push(await pageOf(render(FINAL, one, corners)));
        done++;
        paintPages();
      }
      picker.clear();
      S.picked = [];
      S.src = null; S.corners = null;
      paintStage();
      say(`${done} pages added from your pictures. Reorder or remove them below, then save the PDF.`);
    } catch (err) {
      say(`Stopped after ${done} of ${list.length} pages: ${err?.message || err}`);
    } finally {
      S.busy = false;
      manyBtn.disabled = false;
      paintPicked();
    }
  }
  function paintPages() {
    pagesLabel.textContent = S.pages.length ? `Pages (${S.pages.length})` : 'Pages';
    list.replaceChildren(...S.pages.map((p, i) => h('div.pt-scan__page', { role: 'listitem', dataset: { page: String(i + 1) } },
      h('span.pt-scan__thumb', p.thumb),
      h('span.pt-scan__pn', { text: `Page ${i + 1}` }),
      h('button.ibtn', { type: 'button', 'aria-label': `Move page ${i + 1} up`, disabled: i === 0, onclick: () => move(i, -1) }, icon('arrow-up')),
      h('button.ibtn', { type: 'button', 'aria-label': `Move page ${i + 1} down`, disabled: i === S.pages.length - 1, onclick: () => move(i, 1) }, icon('arrow-down')),
      h('button.ibtn', { type: 'button', 'aria-label': `Remove page ${i + 1}`, onclick: () => { S.pages.splice(i, 1); paintPages(); say(`Page ${i + 1} removed.`); } }, icon('trash')))));
    saveBtn.disabled = dlBtn.disabled = resetBtn.disabled = !S.pages.length;
  }
  function move(i, d) {
    const j = i + d;
    if (j < 0 || j >= S.pages.length) return;
    [S.pages[i], S.pages[j]] = [S.pages[j], S.pages[i]];
    paintPages();
  }

  /* ---------- the PDF ---------- */
  const pdfOf = () => makePdf(S.pages.map(({ width, height, bits, gray, jpeg, paper }) => ({ width, height, bits, gray, jpeg, paper })), { title: t('Scan') });
  async function save() {
    if (!S.pages.length || S.busy) return;
    S.busy = true;
    say('Making the PDF…');
    try {
      const blob = await pdfOf();
      const { path } = await media.save(scansDir(), scanName(), blob);
      S.last = path;
      const n = S.pages.length;
      say(`Saved ${vfs.baseName(path)} in Documents › Scans — ${n} page${n === 1 ? '' : 's'}, ${fmtBytes(blob.size)}.`);
      api.notify({ app: 'Scan', icon: 'file-text', title: t('PDF saved'), message: `${vfs.baseName(path)} · ${n} page${n === 1 ? '' : 's'} · ${fmtBytes(blob.size)}`,
        actions: [{ label: t('Open'), onClick: () => api.openFile(path) }, { label: t('Send with Drop'), onClick: () => api.openApp('drop', { send: [path] }) }, { label: t('Show in Files'), onClick: () => api.openApp('files', { path }) }] });
    } catch (err) { say(`Couldn’t save the PDF: ${err?.message || err}`); }
    finally { S.busy = false; }
  }
  async function download() {
    if (!S.pages.length) return;
    try {
      const blob = await pdfOf();
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: scanName() });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      say(`Downloaded ${scanName()} — ${fmtBytes(blob.size)}.`);
    } catch (err) { say(`Couldn’t make the PDF: ${err?.message || err}`); }
  }

  /* ---------- what the stage shows ---------- */
  function paintStage(mode) {
    const m = mode || (S.src ? 'edit' : 'empty');
    empty.hidden = m !== 'empty';
    problem.hidden = m !== 'problem';
    camView.hidden = m !== 'camera';
    wrap.hidden = m !== 'edit';
    findBtn.disabled = rotBtn.disabled = m !== 'edit';
    stage.dataset.mode = m;
  }
  paintStage('empty');
  paintPages();
  paintModeBits();
  preview.hidden = true;
  if (opts?.path) { const s = sourceOfPath(opts.path); if (s) picker.pick(s); }

  return () => {
    S.alive = false;
    S.pvSeq++;
    clearTimeout(S.pvTimer);
    releaseCamera();
    picker.destroy();
  };
}

export default { mountScan, scanName, scansDir };
