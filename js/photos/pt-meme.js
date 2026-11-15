/* ============================================================
   Meme maker (Picture Tools, #109) — text, stickers and emoji on a picture.

   The picture is drawn at its own size (longest side at most 4096) on one
   <canvas>; what you see is what Save writes. Text is classic meme style:
   capitals, a fill colour with a thick outline in another. The default is
   white with black in Anton (bundled, SIL OFL — css/fonts/), and each box
   can use another font — Bangers (also bundled, SIL OFL) or one the
   computer already has (Impact, Arial Black, Georgia, Courier New,
   Trebuchet MS) — its own fill and outline colours, an outline width and a
   rotation. Each box is sized to fill the picture's width (capped so short
   words don't swallow the picture); the Size slider scales it down or up
   from there. Top and bottom boxes start in place; "Add text box" makes
   more.

   Stickers (the pack StaticOS ships, js/core/stickerpack.js) and emoji can
   be put on the picture too; each has a size and a rotation. Drag any box,
   sticker or emoji with the mouse or a finger. Text is drawn on top of
   them, so it stays readable.
   ============================================================ */
import { pickerView, blobOfSource, bitmapOf, sizeOfBitmap, sourceOfPath, encode, saveBlob, stemOf, clamp, picturesDir } from './pt-common.js';
import { t } from '../core/i18n.js';

export const MEME_FONT = '"Anton", Impact, "Haettenschweiler", "Arial Narrow Bold", sans-serif';
/* the fonts a box can use: two bundled (SIL OFL), the rest ones every computer has */
export const FONTS = [
  { id: 'anton', label: t('Anton'), stack: MEME_FONT },
  { id: 'bangers', label: t('Bangers'), stack: '"Bangers", "Comic Sans MS", "Chalkboard SE", cursive, sans-serif' },
  { id: 'impact', label: t('Impact'), stack: 'Impact, "Haettenschweiler", "Arial Narrow Bold", sans-serif' },
  { id: 'arial-black', label: t('Arial Black'), stack: '"Arial Black", "Helvetica Neue", Arial, sans-serif' },
  { id: 'georgia', label: t('Georgia'), stack: 'Georgia, "Times New Roman", serif' },
  { id: 'courier', label: t('Courier New'), stack: '"Courier New", Courier, monospace' },
  { id: 'trebuchet', label: t('Trebuchet MS'), stack: '"Trebuchet MS", "Lucida Grande", Tahoma, sans-serif' },
];
const fontOf = id => FONTS.find(f => f.id === id) || FONTS[0];
const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
export const EMOJI = ['😂', '🤣', '😎', '🔥', '💀', '😭', '🤔', '😡', '👍', '👎', '🙄', '😱', '💯', '❤️', '🎉', '👀', '🤡', '🥺', '😅', '🙏', '✨', '🚀', '🐸', '🍕'];
const MAX_SIDE = 4096;
const MAX_ITEMS = 24;

const rad = d => d * Math.PI / 180;
/** `p` (picture pixels) in the frame of something centred on (cx, cy) and turned by `deg`. */
const toLocal = (p, cx, cy, deg) => {
  const a = rad(-deg), dx = p.x - cx, dy = p.y - cy;
  return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) };
};

export function mountMeme({ api, root, opts }) {
  const { h, icon } = api;
  const newBox = (id, label, y, scale = 1) => ({ id, label, text: '', x: 0.5, y, scale, font: 'anton', fill: '#ffffff', stroke: '#000000', sw: 14, rot: 0 });
  const S = {
    src: null, bmp: null, W: 0, H: 0, busy: false, alive: true, drag: null, seq: 0,
    boxes: [newBox('top', 'Top text', 0.1), newBox('bottom', 'Bottom text', 0.9)],
    items: [],                 /* stickers and emoji: { id, kind, key|ch, name, x, y, size, rot, img? } */
    sel: 'top', nextId: 1,
  };

  const cv = h('canvas.pt-meme__canvas', { 'aria-label': t('Meme preview') });
  const g = cv.getContext('2d');
  const meas = document.createElement('canvas').getContext('2d');
  const selBox = h('div.pt-meme__sel', { hidden: true, 'aria-hidden': 'true' });
  const paper = h('div.pt-meme__paper', { hidden: true }, cv, selBox);
  const empty = h('div.pt__empty', icon('image'), h('b', { text: t('Pick a picture') }), h('small', { text: t('Choose one on the right, then type your top and bottom text.') }));
  const stage = h('div.pt__stage', empty, paper);
  const foot = h('div.pt__foot', { role: 'status', 'aria-live': 'polite' });

  /* ---------- layout ---------- */
  function layout(b) {
    const lines = String(b.text || '').toUpperCase().split('\n');
    meas.font = `100px ${fontOf(b.font).stack}`;
    const widest = Math.max(...lines.map(l => meas.measureText(l || ' ').width), 1);
    const fit = Math.min(100 * (S.W * 0.94) / widest, S.H * 0.2);
    const px = Math.max(8, fit * b.scale);
    const lh = px * 1.1;
    return { lines, px, lh, w: widest * px / 100, h: lines.length * lh };
  }
  const hasText = b => /\S/.test(b.text || '');
  const itemPx = it => it.size * Math.min(S.W, S.H);
  const find = id => S.boxes.find(b => b.id === id) || S.items.find(i => i.id === id) || null;

  function drawItem(it) {
    const px = itemPx(it);
    g.save();
    g.translate(it.x * S.W, it.y * S.H);
    g.rotate(rad(it.rot));
    if (it.kind === 'emoji') {
      g.font = `${px}px ${EMOJI_FONT}`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(it.ch, 0, px * 0.04);
    } else if (it.img) {
      const iw = it.img.naturalWidth || 100, ih = it.img.naturalHeight || 100;
      const k = px / Math.max(iw, ih);
      g.drawImage(it.img, -iw * k / 2, -ih * k / 2, iw * k, ih * k);
    }
    g.restore();
  }
  function draw() {
    if (!S.bmp) return;
    g.clearRect(0, 0, S.W, S.H);
    g.drawImage(S.bmp, 0, 0, S.W, S.H);
    for (const it of S.items) drawItem(it);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.miterLimit = 2;
    for (const b of S.boxes) {
      if (!hasText(b)) continue;
      const L = layout(b);
      g.save();
      g.translate(b.x * S.W, b.y * S.H);
      g.rotate(rad(b.rot));
      g.font = `${L.px}px ${fontOf(b.font).stack}`;
      g.lineWidth = b.sw ? Math.max(2, L.px * b.sw / 100) : 0;
      g.strokeStyle = b.stroke;
      g.fillStyle = b.fill;
      const y0 = -L.h / 2 + L.lh / 2;
      L.lines.forEach((ln, i) => {
        if (b.sw) g.strokeText(ln, 0, y0 + i * L.lh);
        g.fillText(ln, 0, y0 + i * L.lh);
      });
      g.restore();
    }
    paintSel();
    paintFoot();
  }
  /* the size and place of whatever is picked, in picture pixels */
  function extent(o) {
    if (o.kind) { const px = itemPx(o); return { w: px, h: px }; }
    const L = layout(o);
    return { w: L.w, h: L.h };
  }
  function paintSel() {
    const o = find(S.sel);
    if (!o || (!o.kind && !hasText(o)) || !S.bmp) { selBox.hidden = true; return; }
    const e = extent(o);
    const z = cv.clientWidth / S.W || 1;
    const pad = 6;
    selBox.hidden = false;
    Object.assign(selBox.style, {
      left: `${(o.x * S.W - e.w / 2) * z - pad}px`, top: `${(o.y * S.H - e.h / 2) * z - pad}px`,
      width: `${e.w * z + pad * 2}px`, height: `${e.h * z + pad * 2}px`, transform: `rotate(${o.rot || 0}deg)`,
    });
  }
  function paintFoot() {
    foot.textContent = S.bmp ? `${S.src.name} · ${S.W} × ${S.H} px · drag text, stickers and emoji to move them` : '';
    saveBtn.disabled = !S.bmp || S.busy;
  }

  /* ---------- the controls ---------- */
  const picker = pickerView(api, { onChange: list => { if (list[0]) open(list[0]); else clearPic(); }, label: t('Pictures to make a meme from') });
  const boxList = h('div.pt-meme__boxes');
  const fields = new Map();
  const slider = (label, min, max, value, unit, set, key) => {
    const out = h('output', { text: `${value}${unit}` });
    const input = h('input', { type: 'range', min, max, step: 1, value, 'aria-label': label, dataset: key ? { k: key } : {},
      oninput: () => { set(Number(input.value)); out.textContent = `${input.value}${unit}`; draw(); } });
    return { el: h('label.pt__slider', h('span', { text: label }), input, out), input, out };
  };
  function boxField(b) {
    const ta = h('textarea.pt-meme__text', {
      rows: 2, spellcheck: 'false', placeholder: b.label, dataset: { box: b.id }, 'aria-label': b.label,
      oninput: () => { b.text = ta.value; draw(); },
      onfocus: () => select(b.id),
    });
    const size = h('input', {
      type: 'range', min: 30, max: 130, step: 1, value: Math.round(b.scale * 100), 'aria-label': t('{label} size', { label: b.label }), dataset: { box: b.id },
      oninput: () => { b.scale = Number(size.value) / 100; sizeOut.textContent = `${size.value}%`; draw(); },
    });
    const sizeOut = h('output', { text: `${Math.round(b.scale * 100)}%` });
    const del = b.id !== 'top' && b.id !== 'bottom'
      ? h('button.ibtn', { type: 'button', 'aria-label': t('Remove {label}', { label: b.label }), title: t('Remove this text'), onclick: () => remove(b.id) }, icon('trash'))
      : null;
    const fontSel = h('select', { 'aria-label': t('{label} font', { label: b.label }), dataset: { k: 'font', box: b.id },
      onchange: async () => { b.font = fontSel.value; try { await document.fonts.load(`100px ${fontOf(b.font).stack}`); } catch (e) { /* the fallback draws */ } draw(); } },
      FONTS.map(f => h('option', { value: f.id, text: f.label, selected: f.id === b.font })));
    const fill = h('input.pt-meme__color', { type: 'color', value: b.fill, 'aria-label': t('{label} text colour', { label: b.label }), dataset: { k: 'fill', box: b.id }, oninput: () => { b.fill = fill.value; draw(); } });
    const stroke = h('input.pt-meme__color', { type: 'color', value: b.stroke, 'aria-label': t('{label} outline colour', { label: b.label }), dataset: { k: 'stroke', box: b.id }, oninput: () => { b.stroke = stroke.value; draw(); } });
    const sw = slider('Outline', 0, 30, b.sw, '%', v => { b.sw = v; }, 'sw');
    sw.input.setAttribute('aria-label', `${b.label} outline width`);
    sw.input.dataset.box = b.id;
    const rot = slider('Turn', -180, 180, b.rot, '°', v => { b.rot = v; }, 'rot');
    rot.input.setAttribute('aria-label', `${b.label} rotation`);
    rot.input.dataset.box = b.id;
    const row = h('div.pt-meme__box', { dataset: { box: b.id } },
      h('div.pt__rowhead', h('b', { text: b.label }), del),
      ta,
      h('div.pt-meme__style', fontSel, h('label.pt-meme__swatch', { title: t('Text colour') }, h('span', { text: t('Text') }), fill), h('label.pt-meme__swatch', { title: t('Outline colour') }, h('span', { text: t('Outline{o}', { o: '' }) }), stroke)),
      h('label.pt__slider', h('span', { text: t('Size') }), size, sizeOut),
      sw.el, rot.el);
    fields.set(b.id, { row, ta });
    return row;
  }
  function itemRow(it) {
    const name = it.kind === 'emoji' ? `Emoji ${it.ch}` : `Sticker ${it.name}`;
    const sz = slider('Size', 4, 100, Math.round(it.size * 100), '%', v => { it.size = v / 100; }, 'size');
    sz.input.setAttribute('aria-label', `${name} size`);
    const rt = slider('Turn', -180, 180, it.rot, '°', v => { it.rot = v; }, 'rot');
    rt.input.setAttribute('aria-label', `${name} rotation`);
    const row = h('div.pt-meme__box.pt-meme__item', { dataset: { item: it.id }, onpointerdown: () => select(it.id) },
      h('div.pt__rowhead', h('b', { text: name }), h('span.pt__spacer'),
        h('button.ibtn', { type: 'button', 'aria-label': t('Remove {name}', { name }), title: t('Take this off the picture'), onclick: () => removeItem(it.id) }, icon('trash'))),
      sz.el, rt.el);
    fields.set(it.id, { row });
    return row;
  }
  function select(id) {
    S.sel = id;
    for (const [k, f] of fields) f.row.classList.toggle('is-sel', k === id);
    paintSel();
  }
  function rebuildBoxes() {
    fields.clear();
    boxList.replaceChildren(...S.boxes.map(boxField), ...S.items.map(itemRow));
    for (const b of S.boxes) fields.get(b.id).ta.value = b.text;
    select(find(S.sel) ? S.sel : 'top');
  }
  function addBox() {
    const b = newBox(`x${++S.nextId}`, `Text ${S.boxes.length - 1}`, 0.5, 0.6);
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
  function removeItem(id) {
    S.items = S.items.filter(i => i.id !== id);
    if (S.sel === id) S.sel = 'top';
    rebuildBoxes();
    draw();
    if (S.alive) paintStickerBtns();
  }
  function addItem(it) {
    if (S.items.length >= MAX_ITEMS) { api.notify({ app: 'Picture Tools', icon: 'alert', title: t('That’s plenty'), message: t('A meme can hold {MAX_ITEMS} stickers and emoji. Take one off to add another.', { MAX_ITEMS }) }); return; }
    const n = S.items.length;
    S.items.push({ id: `i${++S.nextId}`, x: clamp(0.5 + ((n % 5) - 2) * 0.08, 0.1, 0.9), y: clamp(0.5 + (Math.floor(n / 5) % 3 - 1) * 0.1, 0.1, 0.9), size: 0.22, rot: 0, ...it });
    rebuildBoxes();
    select(S.items[S.items.length - 1].id);
    draw();
    paintStickerBtns();
  }

  /* stickers (the pack the desktop uses) and emoji */
  let pack = null;
  const stickerGrid = h('div.pt-meme__stickers', { role: 'group', 'aria-label': t('Stickers') });
  const emojiGrid = h('div.pt-meme__emoji', { role: 'group', 'aria-label': t('Emoji') }, EMOJI.map(ch => h('button.pt-meme__emo', {
    type: 'button', 'aria-label': t('Add {ch}', { ch }), title: t('Add {ch}', { ch }), dataset: { emoji: ch }, disabled: true, onclick: () => addItem({ kind: 'emoji', ch }),
  }, ch)));
  const emojiIn = h('input', { type: 'text', maxlength: 8, placeholder: t('Or type or paste an emoji'), 'aria-label': t('Any emoji'),
    onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); addTyped(); } } });
  function addTyped() {
    const t = emojiIn.value.trim();
    if (!t || !S.bmp) return;
    const ch = typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(t)][0].segment : Array.from(t)[0];
    addItem({ kind: 'emoji', ch });
    emojiIn.value = '';
  }
  function paintStickerBtns() {
    const off = !S.bmp;
    for (const b of stickerGrid.children) b.disabled = off;
    for (const b of emojiGrid.children) b.disabled = off;
    emojiIn.disabled = off;
  }
  const loadImg = url => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('That sticker would not load.')); im.src = url; });
  async function stickerPack() {
    if (pack) return pack;
    pack = await import('../core/stickerpack.js');
    stickerGrid.replaceChildren(...pack.STICKERS.map(s => h('button.pt-meme__stk', {
      type: 'button', 'aria-label': t('Add {name} sticker', { name: s.name }), title: s.name, dataset: { sticker: s.id }, disabled: !S.bmp,
      onclick: async () => {
        try {
          const img = await loadImg(pack.artUrl(s.id));
          if (S.alive) addItem({ kind: 'sticker', key: s.id, name: s.name, img });
        } catch (err) { api.notify({ app: 'Picture Tools', icon: 'alert', title: t('Can’t use that sticker'), message: err?.message || String(err) }); }
      },
    }, h('img', { src: pack.artUrl(s.id), alt: '', draggable: 'false' }))));
    return pack;
  }
  stickerPack().catch(() => { stickerGrid.replaceChildren(h('small.pt__hint', { text: t('The sticker pack didn’t load.') })); });

  const addBtn = h('button.btn.btn--sm', { type: 'button', onclick: addBox }, icon('plus'), h('span', { text: t('Add text box') }));
  const saveBtn = h('button.btn.btn--primary', { type: 'button', 'aria-label': t('Save a copy to Pictures'), onclick: () => save() },
    icon('save'), h('span', { text: t('Save a copy to Pictures') }));
  const side = h('div.pt__side', picker.el, boxList,
    h('div.pt__group', h('b.pt__label', { text: t('Stickers') }), stickerGrid),
    h('div.pt__group', h('b.pt__label', { text: t('Emoji') }), emojiGrid, h('div.pt__line', emojiIn, h('button.btn.btn--sm', { type: 'button', onclick: addTyped }, icon('plus'), h('span', { text: t('Add') })))),
    h('div.pt__actions', addBtn, saveBtn));
  root.append(h('div.pt__split', h('div.pt__col', stage, foot), side));
  rebuildBoxes();

  /* ---------- open / save ---------- */
  function clearPic() {
    S.seq++;
    S.bmp = null; S.src = null;
    paper.hidden = true; empty.hidden = false;
    paintFoot();
    paintStickerBtns();
  }
  async function loadFonts() {
    for (const f of new Set(S.boxes.map(b => b.font))) {
      try { await document.fonts.load(`100px ${fontOf(f).stack}`); } catch (e) { /* the fallbacks draw */ }
    }
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
      paintStickerBtns();
      await loadFonts();
      if (!S.alive || seq !== S.seq) return;
      draw();
    } catch (err) {
      if (seq === S.seq) api.notify({ app: 'Picture Tools', icon: 'alert', title: t('Can’t open that picture'), message: err?.message || String(err) });
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
      await saveBlob(api, 'Picture Tools', picturesDir(), `${stemOf(S.src.name)} (meme).png`, blob, { title: t('Meme saved') });
      S.sel = prev;
    } catch (err) {
      api.notify({ app: 'Picture Tools', icon: 'alert', title: t('Not saved'), message: err?.message || String(err) });
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
      const q = toLocal(p, b.x * S.W, b.y * S.H, b.rot);
      if (Math.abs(q.x) <= L.w / 2 + pad && Math.abs(q.y) <= L.h / 2 + pad) return b;
    }
    for (let i = S.items.length - 1; i >= 0; i--) {
      const it = S.items[i], px = itemPx(it);
      const q = toLocal(p, it.x * S.W, it.y * S.H, it.rot);
      if (Math.abs(q.x) <= px / 2 && Math.abs(q.y) <= px / 2) return it;
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
    const b = find(S.drag.id);
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

  /* test and debugging hook: what the boxes and items are */
  root.memePeek = () => ({
    W: S.W, H: S.H, sel: S.sel,
    boxes: S.boxes.map(b => ({ id: b.id, text: b.text, x: b.x, y: b.y, scale: b.scale, font: b.font, fill: b.fill, stroke: b.stroke, sw: b.sw, rot: b.rot })),
    items: S.items.map(i => ({ id: i.id, kind: i.kind, key: i.key, ch: i.ch, x: i.x, y: i.y, size: i.size, rot: i.rot })),
  });

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
