/* ============================================================
   ASCII art (Picture Tools, #115) — a picture or some words as text.

   Picture: each character stands for a block of the picture. The block's
   average brightness (Rec. 709 luminance, transparent pixels counted as
   white) picks a character from a ramp that runs from sparse to dense;
   bright is dense, which reads right on a dark screen — Invert flips it for
   dark ink on light paper. Contrast stretches the brightness around the
   middle first. Rows are half as many as a square grid would give, because
   a character is about twice as tall as it is wide.

   Text: big banner letters from BANNER_FONT below — a 5-row block font
   drawn for StaticOS (nothing copied from FIGlet or any other font). Each
   dot of a letter becomes the fill character, two across by default so the
   letters come out square. A–Z, 0–9 and a little punctuation; lower case
   is shown as capitals; anything else is skipped and named.

   Either result can be copied as text or saved as a .txt in ~/Documents.
   ============================================================ */
import { pickerView, blobOfSource, bitmapOf, sizeOfBitmap, sourceOfPath, clamp } from './pt-common.js';
import vfs from '../core/vfs.js';

export const RAMPS = [
  { id: 'classic', label: 'Classic', chars: ' .:-=+*#%@' },
  { id: 'simple', label: 'Simple', chars: ' .oO@' },
  { id: 'blocks', label: 'Blocks', chars: ' ░▒▓█' },
  { id: 'binary', label: 'Two tones', chars: ' #' },
];

/* ---------- picture -> characters ---------- */
export const lumaOf = (r, g, b, a) => {
  const k = a / 255;
  const f = c => c * k + 255 * (1 - k);          /* transparent shows white */
  return (0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)) / 255;
};

/** ImageData -> text. o: { cols, ramp (string), invert, contrast (-100..100) } */
export function imageToAscii(img, o) {
  const { width: W, height: H, data } = img;
  const cols = clamp(Math.round(o.cols), 1, 400);
  const rows = Math.max(1, Math.round(H / W * cols * 0.5));
  const ramp = [...o.ramp];
  const k = o.contrast >= 0 ? 1 + o.contrast / 20 : 1 + o.contrast / 100;
  const lines = [];
  for (let r = 0; r < rows; r++) {
    const y0 = Math.floor(r * H / rows), y1 = Math.max(y0 + 1, Math.floor((r + 1) * H / rows));
    let line = '';
    for (let c = 0; c < cols; c++) {
      const x0 = Math.floor(c * W / cols), x1 = Math.max(x0 + 1, Math.floor((c + 1) * W / cols));
      let sum = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0, i = (y * W + x0) * 4; x < x1; x++, i += 4) { sum += lumaOf(data[i], data[i + 1], data[i + 2], data[i + 3]); n++; }
      }
      let l = sum / n;
      l = clamp((l - 0.5) * k + 0.5, 0, 1);
      if (o.invert) l = 1 - l;
      line += ramp[Math.min(ramp.length - 1, Math.floor(l * ramp.length))];
    }
    lines.push(line.replace(/\s+$/, ''));
  }
  return lines.join('\n');
}

/* ---------- words -> banner ---------- */
const G = s => s.trim().split(/\s+/);
export const BANNER_FONT = {
  A: G('.###. #...# ##### #...# #...#'), B: G('####. #...# ####. #...# ####.'), C: G('.#### #.... #.... #.... .####'),
  D: G('####. #...# #...# #...# ####.'), E: G('##### #.... ####. #.... #####'), F: G('##### #.... ####. #.... #....'),
  G: G('.#### #.... #..## #...# .###.'), H: G('#...# #...# ##### #...# #...#'), I: G('##### ..#.. ..#.. ..#.. #####'),
  J: G('..### ...#. ...#. #..#. .##..'), K: G('#...# #..#. ###.. #..#. #...#'), L: G('#.... #.... #.... #.... #####'),
  M: G('#...# ##.## #.#.# #...# #...#'), N: G('#...# ##..# #.#.# #..## #...#'), O: G('.###. #...# #...# #...# .###.'),
  P: G('####. #...# ####. #.... #....'), Q: G('.###. #...# #.#.# #..#. .##.#'), R: G('####. #...# ####. #..#. #...#'),
  S: G('.#### #.... .###. ....# ####.'), T: G('##### ..#.. ..#.. ..#.. ..#..'), U: G('#...# #...# #...# #...# .###.'),
  V: G('#...# #...# #...# .#.#. ..#..'), W: G('#...# #...# #.#.# ##.## #...#'), X: G('#...# .#.#. ..#.. .#.#. #...#'),
  Y: G('#...# .#.#. ..#.. ..#.. ..#..'), Z: G('##### ....# ..#.. #.... #####'),
  0: G('.###. #..## #.#.# ##..# .###.'), 1: G('..#.. .##.. ..#.. ..#.. .###.'), 2: G('.###. #...# ..##. .#... #####'),
  3: G('####. ....# .###. ....# ####.'), 4: G('#..#. #..#. ##### ...#. ...#.'), 5: G('##### #.... ####. ....# ####.'),
  6: G('.###. #.... ####. #...# .###.'), 7: G('##### ....# ...#. ..#.. ..#..'), 8: G('.###. #...# .###. #...# .###.'),
  9: G('.###. #...# .#### ....# .###.'),
  '!': G('# # # . #'), '.': G('. . . . #'), ',': G('.. .. .. .# #.'), '-': G('... ... ### ... ...'),
  ':': G('. # . # .'), "'": G('# # . . .'), '?': G('.###. #...# ..##. ..... ..#..'),
  '+': G('..... ..#.. ##### ..#.. .....'), '=': G('..... ##### ..... ##### .....'), '/': G('....# ...#. ..#.. .#... #....'),
  ' ': G('... ... ... ... ...'),
};
export const FILLS = ['█', '#', '@', '*'];

/** Words -> banner text. o: { fill, wide }. Returns { text, skipped }. */
export function banner(words, o) {
  const skipped = new Set();
  const blocks = String(words || '').toUpperCase().split('\n').map(line => {
    const rows = ['', '', '', '', ''];
    let first = true;
    for (const ch of line) {
      const gl = BANNER_FONT[ch];
      if (!gl) { skipped.add(ch); continue; }
      for (let r = 0; r < 5; r++) {
        const cells = [...gl[r]].map(c => (c === '#' ? o.fill : ' ').repeat(o.wide ? 2 : 1)).join('');
        rows[r] += (first ? '' : ' '.repeat(o.wide ? 2 : 1)) + cells;
      }
      first = false;
    }
    return first ? null : rows.map(r => r.replace(/\s+$/, '')).join('\n');
  });
  return { text: blocks.filter(Boolean).join('\n\n'), skipped: [...skipped] };
}

/* ---------- the tool ---------- */
export function mountAscii({ api, root, opts }) {
  const { h, icon } = api;
  const S = { mode: 'picture', text: '', alive: true, imgData: null, name: '', seq: 0 };
  const O = { cols: 80, ramp: 'classic', invert: false, contrast: 0, fill: '█', wide: true, words: '' };

  const pre = h('pre.pt-ascii__pre', { tabindex: 0, 'aria-label': 'ASCII art', dataset: { mode: 'picture' } });
  const stage = h('div.pt__stage.pt-ascii__stage', pre);
  const foot = h('div.pt__foot', { role: 'status', 'aria-live': 'polite' });

  function fitFont() {
    const lines = S.text.split('\n');
    const cols = Math.max(1, ...lines.map(l => [...l].length));
    const aw = Math.max(80, stage.clientWidth - 40);
    const px = clamp(aw / (cols * 0.6), 3, 16);
    pre.style.fontSize = `${px.toFixed(2)}px`;
    pre.style.lineHeight = '1.0';
  }
  function show(text, note) {
    S.text = text;
    pre.textContent = text;
    fitFont();
    const lines = text ? text.split('\n') : [];
    foot.textContent = text ? `${note || ''}${note ? ' · ' : ''}${Math.max(0, ...lines.map(l => [...l].length))} × ${lines.length} characters` : (note || '');
    copyBtn.disabled = saveBtn.disabled = !text;
  }
  function render() {
    pre.dataset.mode = S.mode;
    if (S.mode === 'picture') {
      if (!S.imgData) { show('', 'Pick a picture to turn into text'); return; }
      const ramp = RAMPS.find(r => r.id === O.ramp).chars;
      show(imageToAscii(S.imgData, { cols: O.cols, ramp, invert: O.invert, contrast: O.contrast }), S.name);
    } else {
      const { text, skipped } = banner(O.words, { fill: O.fill, wide: O.wide });
      show(text, skipped.length ? `Not in the font: ${skipped.map(c => (c === ' ' ? 'space' : c)).join(' ')}` : (O.words.trim() ? '' : 'Type some words'));
    }
  }

  /* ---------- picture side ---------- */
  async function open(src) {
    const seq = ++S.seq;
    try {
      const bmp = await bitmapOf(await blobOfSource(src));
      let { w, h: hh } = sizeOfBitmap(bmp);
      const k = Math.min(1, 1600 / Math.max(w, hh));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(hh * k));
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close?.();
      if (!S.alive || seq !== S.seq) return;
      S.imgData = g.getImageData(0, 0, c.width, c.height);
      S.name = src.name;
      render();
    } catch (err) {
      if (seq === S.seq) api.notify({ app: 'Picture Tools', icon: 'alert', title: 'Can’t open that picture', message: err?.message || String(err) });
    }
  }
  const picker = pickerView(api, { label: 'Pictures to turn into ASCII', onChange: list => { if (list[0]) open(list[0]); else { S.imgData = null; render(); } } });
  const slider = (label, key, min, max, fmt = v => String(v)) => {
    const out = h('output', { text: fmt(O[key]) });
    const input = h('input', { type: 'range', min, max, step: 1, value: O[key], 'aria-label': label, dataset: { key },
      oninput: () => { O[key] = Number(input.value); out.textContent = fmt(O[key]); render(); } });
    return h('label.pt__slider', h('span', { text: label }), input, out);
  };
  const rampSel = h('select', { 'aria-label': 'Characters', onchange: () => { O.ramp = rampSel.value; render(); } },
    RAMPS.map(r => h('option', { value: r.id, text: `${r.label}  ${r.chars.trim() ? r.chars.replace(/ /g, '·') : ''}` })));
  const invert = h('input', { type: 'checkbox', 'aria-label': 'Invert', onchange: () => { O.invert = invert.checked; render(); } });
  const pictureSide = h('div.pt__group',
    picker.el,
    slider('Width', 'cols', 20, 200, v => `${v} chars`),
    slider('Contrast', 'contrast', -100, 100, v => (v > 0 ? `+${v}` : String(v))),
    h('label.pt__line', h('span', { text: 'Characters' }), rampSel),
    h('label.pt__check', invert, h('span', { text: 'Invert (dark ink on light paper)' })));

  /* ---------- text side ---------- */
  const words = h('textarea.pt-ascii__words', { rows: 3, spellcheck: 'false', placeholder: 'Type something', 'aria-label': 'Words for the banner',
    oninput: () => { O.words = words.value; render(); } });
  const fillSel = h('select', { 'aria-label': 'Fill character', onchange: () => { O.fill = fillSel.value; render(); } },
    FILLS.map(f => h('option', { value: f, text: f })));
  const wide = h('input', { type: 'checkbox', checked: true, 'aria-label': 'Wide letters', onchange: () => { O.wide = wide.checked; render(); } });
  const textSide = h('div.pt__group', { hidden: true }, h('label.pt__col2', h('span.pt__label', { text: 'Words' }), words),
    h('label.pt__line', h('span', { text: 'Fill' }), fillSel),
    h('label.pt__check', wide, h('span', { text: 'Wide letters (two characters per dot, so they look square)' })));

  const modeBtns = [['picture', 'Picture', 'image'], ['text', 'Text banner', 'type']].map(([id, label, ic]) => h('button.pt__segbtn', {
    type: 'button', role: 'radio', 'aria-checked': String(id === S.mode), dataset: { v: id },
    onclick: () => { S.mode = id; for (const b of modeBtns) b.setAttribute('aria-checked', String(b.dataset.v === id)); pictureSide.hidden = id !== 'picture'; textSide.hidden = id !== 'text'; render(); },
  }, icon(ic), h('span', { text: label })));

  /* ---------- copy and save ---------- */
  const say = (title, message, ic = 'file-text', actions) => api.notify({ app: 'Picture Tools', icon: ic, title, message, actions });
  async function copy() {
    if (!S.text) return;
    try {
      await navigator.clipboard.writeText(S.text);
    } catch (err) {
      /* no clipboard permission: select it so Ctrl+C works */
      const sel = getSelection(), r = document.createRange();
      r.selectNodeContents(pre); sel.removeAllRanges(); sel.addRange(r);
      if (!document.execCommand?.('copy')) { say('Select and copy', 'The browser wouldn’t let StaticOS copy for you. The text is selected, so press Ctrl+C.'); return; }
    }
    say('Copied', `${S.text.split('\n').length} lines of text`);
  }
  function save() {
    if (!S.text) return;
    const dir = `${vfs.HOME}/Documents`;
    if (!vfs.node(dir)) vfs.mkdir(dir);
    const stem = S.mode === 'picture' ? `${(S.name || 'picture').replace(/\.[^.]+$/, '')} ASCII` : `${(O.words.trim().split('\n')[0] || 'banner').slice(0, 24)} banner`;
    let name = `${stem}.txt`, i = 2;
    while (vfs.node(`${dir}/${name}`)) name = `${stem} ${i++}.txt`;
    const node = vfs.write(`${dir}/${name}`, S.text + '\n');
    if (!node) { say('Not saved', `${dir} can’t be written.`, 'alert'); return; }
    say('Saved', name, 'file-text', [{ label: 'Open', onClick: () => api.openFile(`${dir}/${name}`) }, { label: 'Show in Files', onClick: () => api.openApp('files', { path: `${dir}/${name}` }) }]);
  }
  const copyBtn = h('button.btn', { type: 'button', 'aria-label': 'Copy as text', onclick: () => copy() }, icon('copy'), h('span', { text: 'Copy text' }));
  const saveBtn = h('button.btn.btn--primary', { type: 'button', 'aria-label': 'Save as a .txt file', onclick: () => save() }, icon('save'), h('span', { text: 'Save .txt' }));

  const side = h('div.pt__side', h('div.pt__seg', { role: 'radiogroup', 'aria-label': 'Make ASCII art from' }, modeBtns), pictureSide, textSide, h('div.pt__actions', copyBtn, saveBtn));
  root.append(h('div.pt__split', h('div.pt__col', stage, foot), side));
  render();

  const ro = new ResizeObserver(() => fitFont());
  ro.observe(stage);
  root.asciiPeek = () => ({ mode: S.mode, text: S.text });
  const first = opts?.path && sourceOfPath(opts.path);
  if (first) picker.pick(first);

  return () => { S.alive = false; ro.disconnect(); picker.destroy(); };
}
