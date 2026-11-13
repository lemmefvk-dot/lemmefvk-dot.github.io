/* ============================================================
   Meme maker (Picture Tools, #109) — top and bottom text on a picture.

   The picture is drawn at its own size (longest side at most 4096) on one
   <canvas>; what you see is what Save writes. Text is classic impact style:
   capitals, white with a thick black outline, in Anton (bundled, SIL OFL —
   css/fonts/) with Impact and friends as the fallback. Each box is sized to
   fill the picture's width (capped so short words don't swallow the
   picture); the Size slider scales it down or up from there. Top and bottom
   boxes start in place; "Add text box" makes more. Drag any box with the
   mouse or a finger.
   ============================================================ */
import { pickerView, blobOfSource, bitmapOf, sizeOfBitmap, sourceOfPath, encode, saveBlob, stemOf, clamp, picturesDir } from './pt-common.js';

export const MEME_FONT = '"Anton", Impact, "Haettenschweiler", "Arial Narrow Bold", sans-serif';
const MAX_SIDE = 4096;

export function mountMeme({ api, root, opts }) {
  const { h, icon } = api;
  const S = {
    src: null, bmp: null, W: 0, H: 0, busy: false, alive: true, drag: null, seq: 0,
    boxes: [
      { id: 'top', label: 'Top text', text: '', x: 0.5, y: 0.1, scale: 1 },
      { id: 'bottom', label: 'Bottom text', text: '', x: 0.5, y: 0.9, scale: 1 },
    ],
    sel: 'top', nextId: 1,
  };

  const cv = h('canvas.pt-meme__canvas', { 'aria-label': 'Meme preview' });
  const g = cv.getContext('2d');
  const meas = document.createElement('canvas').getContext('2d');
  const selBox = h('div.pt-meme__sel', { hidden: true, 'aria-hidden': 'true' });
  const paper = h('div.pt-meme__paper', { hidden: true }, cv, selBox);
  const empty = h('div.pt__empty', icon('image'), h('b', { text: 'Pick a picture' }), h('small', { text: 'Choose one on the right, then type your top and bottom text.' }));
  const stage = h('div.pt__stage', empty, paper);
  const foot = h('div.pt__foot', { role: 'status', 'aria-live': 'polite' });

  /* ---------- text layout ---------- */
  function layout(b) {
    const lines = String(b.text || '').toUpperCase().split('\n');
    meas.font = `100px ${MEME_FONT}`;
    const widest = Math.max(...lines.map(l => meas.measureText(l || ' ').width), 1);
    const fit = Math.min(100 * (S.W * 0.94) / widest, S.H * 0.2);
    const px = Math.max(8, fit * b.scale);
    const lh = px * 1.1;
    return { lines, px, lh, w: widest * px / 100, h: lines.length * lh };
  }
  const hasText = b => /\S/.test(b.text || '');

  function draw() {
    if (!S.bmp) return;
    g.clearRect(0, 0, S.W, S.H);
    g.drawImage(S.bmp, 0, 0, S.W, S.H);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.miterLimit = 2;
    for (const b of S.boxes) {
      if (!hasText(b)) continue;
      const L = layout(b);
      g.font = `${L.px}px ${MEME_FONT}`;
      g.lineWidth = Math.max(2, L.px * 0.14);
      g.strokeStyle = '#000';
      g.fillStyle = '#fff';
      const y0 = b.y * S.H - L.h / 2 + L.lh / 2;
      L.lines.forEach((ln, i) => {
        g.strokeText(ln, b.x * S.W, y0 + i * L.lh);
        g.fillText(ln, b.x * S.W, y0 + i * L.lh);
      });
    }
    paintSel();
    paintFoot();
  }
  function paintSel() {
    const b = S.boxes.find(x => x.id === S.sel);
    if (!b || !hasText(b) || !S.bmp) { selBox.hidden = true; return; }
    const L = layout(b);
    const z = cv.clientWidth / S.W || 1;
    const pad = 6;
    selBox.hidden = false;
    Object.assign(selBox.style, {
      left: `${(b.x * S.W - L.w / 2) * z - pad}px`, top: `${(b.y * S.H - L.h / 2) * z - pad}px`,
      width: `${L.w * z + pad * 2}px`, height: `${L.h * z + pad * 2}px`,
    });
  }
  function paintFoot() {
    foot.textContent = S.bmp ? `${S.src.name} · ${S.W} × ${S.H} px · drag text to move it` : '';
    saveBtn.disabled = !S.bmp || S.busy;
  }

  /* ---------- controls ---------- */
  const picker = pickerView(api, { onChange: list => { if (list[0]) open(list[0]); else clearPic(); }, label: 'Pictures to make a meme from' });
  const boxList = h('div.pt-meme__boxes');
  const fields = new Map();
  function boxField(b) {
    const ta = h('textarea.pt-meme__text', {
      rows: 2, spellcheck: 'false', placeholder: b.label, dataset: { box: b.id }, 'aria-label': b.label,
      oninput: () => { b.text = ta.value; draw(); },
      onfocus: () => select(b.id),
    });
    const size = h('input', {
      type: 'range', min: 30, max: 130, step: 1, value: Math.round(b.scale * 100), 'aria-label': `${b.label} size`, dataset: { box: b.id },
      oninput: () => { b.scale = Number(size.value) / 100; sizeOut.textContent = `${size.value}%`; draw(); },
    });
    const sizeOut = h('output', { text: `${Math.round(b.scale * 100)}%` });
    const del = b.id !== 'top' && b.id !== 'bottom'
      ? h('button.ibtn', { type: 'button', 'aria-label': `Remove ${b.label}`, title: 'Remove this text', onclick: () => remove(b.id) }, icon('trash'))
      : null;
    const row = h('div.pt-meme__box', { dataset: { box: b.id } },
      h('div.pt__rowhead', h('b', { text: b.label }), del),
      ta,
      h('label.pt__slider', h('span', { text: 'Size' }), size, sizeOut));
    fields.set(b.id, { row, ta });
    return row;
  }
  function select(id) {
    S.sel = id;
    for (const [k, f] of fields) f.row.classList.toggle('is-sel', k === id);
    paintSel();
  }
  function rebuildBoxes() {
    fields.clear();
    boxList.replaceChildren(...S.boxes.map(boxField));
    for (const b of S.boxes) fields.get(b.id).ta.value = b.text;
    select(S.sel);
  }
  function addBox() {
    const b = { id: `x${++S.nextId}`, label: `Text ${S.boxes.length - 1}`, text: '', x: 0.5, y: 0.5, scale: 0.6 };
    S.boxes.push(b);
    rebuildBoxes();
    select(b.id);
    fields.get(b.id).ta.focus();
    draw();
  }
  function remove(id) {
    S.boxes = S.boxes.filter(b => b.id !== id);
    if (S.sel === id) S.sel = 'top';
    rebuildBoxes();
    draw();
  }
  const addBtn = h('button.btn.btn--sm', { type: 'button', onclick: addBox }, icon('plus'), h('span', { text: 'Add text box' }));
  const saveBtn = h('button.btn.btn--primary', { type: 'button', 'aria-label': 'Save a copy to Pictures', onclick: () => save() },
    icon('save'), h('span', { text: 'Save a copy to Pictures' }));
  const side = h('div.pt__side', picker.el, boxList, h('div.pt__actions', addBtn, saveBtn));
  root.append(h('div.pt__split', h('div.pt__col', stage, foot), side));
  rebuildBoxes();

  /* ---------- open / save ---------- */
  function clearPic() {
    S.seq++;
    S.bmp = null; S.src = null;
    paper.hidden = true; empty.hidden = false;
    paintFoot();
  }
  async function open(src) {
    const seq = ++S.seq;
    try {
      const blob = await blobOfSource(src);
      const bmp = await bitmapOf(blob);
      if (!S.alive || seq !== S.seq) return;
      let { w, h: hh } = sizeOfBitmap(bmp);
      if (!w || !hh) throw new Error('This picture has no size of its own.');
      const k = Math.min(1, MAX_SIDE / Math.max(w, hh));
      S.W = Math.round(w * k); S.H = Math.round(hh * k);
      S.bmp = bmp; S.src = src;
      cv.width = S.W; cv.height = S.H;
      paper.style.aspectRatio = `${S.W} / ${S.H}`;
      paper.hidden = false; empty.hidden = true;
      try { await document.fonts.load(`100px ${MEME_FONT}`); } catch (e) { /* the fallbacks draw */ }
      if (!S.alive || seq !== S.seq) return;
      draw();
    } catch (err) {
      if (seq === S.seq) api.notify({ app: 'Picture Tools', icon: 'alert', title: 'Can’t open that picture', message: err?.message || String(err) });
    }
  }
  async function save() {
    if (!S.bmp || S.busy) return;
    S.busy = true;
    paintFoot();
    try {
      const prev = S.sel;
      selBox.hidden = true;
      draw();
      const blob = await encode(cv, 'image/png');
      if (!blob) throw new Error('The picture could not be encoded as a PNG.');
      await saveBlob(api, 'Picture Tools', picturesDir(), `${stemOf(S.src.name)} (meme).png`, blob, { title: 'Meme saved' });
      S.sel = prev;
    } catch (err) {
      api.notify({ app: 'Picture Tools', icon: 'alert', title: 'Not saved', message: err?.message || String(err) });
    } finally {
      S.busy = false;
      if (S.alive) { paintFoot(); paintSel(); }
    }
  }

  /* ---------- dragging ---------- */
  function at(e) {
    const r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) * S.W / r.width, y: (e.clientY - r.top) * S.H / r.height };
  }
  function hit(p) {
    for (let i = S.boxes.length - 1; i >= 0; i--) {
      const b = S.boxes[i];
      if (!hasText(b)) continue;
      const L = layout(b), pad = Math.max(10, L.px * 0.15);
      if (Math.abs(p.x - b.x * S.W) <= L.w / 2 + pad && Math.abs(p.y - b.y * S.H) <= L.h / 2 + pad) return b;
    }
    return null;
  }
  cv.addEventListener('pointerdown', e => {
    if (!S.bmp) return;
    const p = at(e), b = hit(p);
    if (!b) return;
    e.preventDefault();
    select(b.id);
    S.drag = { id: b.id, dx: p.x - b.x * S.W, dy: p.y - b.y * S.H };
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
  });
  cv.addEventListener('pointermove', e => {
    if (!S.drag) return;
    const b = S.boxes.find(x => x.id === S.drag.id);
    if (!b) return;
    const p = at(e);
    b.x = clamp((p.x - S.drag.dx) / S.W, 0, 1);
    b.y = clamp((p.y - S.drag.dy) / S.H, 0, 1);
    draw();
  });
  const endDrag = () => { S.drag = null; };
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);
  const fitBox = () => { cv.style.maxHeight = `${Math.max(120, stage.clientHeight - 40)}px`; paintSel(); };
  const ro = new ResizeObserver(fitBox);
  ro.observe(stage);
  const onFonts = () => { if (S.alive && S.bmp) draw(); };
  document.fonts?.addEventListener?.('loadingdone', onFonts);

  /* test and debugging hook: what the boxes are */
  root.memePeek = () => ({ W: S.W, H: S.H, boxes: S.boxes.map(b => ({ id: b.id, text: b.text, x: b.x, y: b.y, scale: b.scale })), sel: S.sel });

  const first = opts?.path && sourceOfPath(opts.path);
  if (first) picker.pick(first);

  return () => {
    S.alive = false;
    ro.disconnect();
    picker.destroy();
    document.fonts?.removeEventListener?.('loadingdone', onFonts);
    cv.width = cv.height = 0;
  };
}
