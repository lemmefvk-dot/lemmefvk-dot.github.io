/* ============================================================
   Image converter (Picture Tools, #112) — resize and change format.

   Pick one or many pictures. Size is a percentage, or a width and height
   in pixels (with the lock on, one side follows the other and a mixed
   batch keeps each picture's own shape). Format is PNG, JPG or WebP, with
   a Quality slider for JPG and WebP.

   "Estimated" is measured, not guessed: a small copy of each picture is
   encoded with the chosen settings and the bytes are scaled up by the
   pixel counts. "Result" is the real size of the file that was written.
   Convert saves a copy beside each original ("name (960×540).jpg", " 2" if
   taken) and never touches the original unless "Replace the originals" is
   on and confirmed. A browser that can't encode WebP says so and the
   option is switched off. Pictures are converted one at a time.
   ============================================================ */
import { pickerView, blobOfSource, bitmapOf, sizeOfBitmap, sourceOfPath, encode, stemOf, clamp, destFor, picturesDir } from './pt-common.js';
import * as media from '../core/media.js';
import vfs from '../core/vfs.js';

export const FORMATS = [
  { id: 'png', label: 'PNG', type: 'image/png', ext: 'png', lossy: false },
  { id: 'jpeg', label: 'JPG', type: 'image/jpeg', ext: 'jpg', lossy: true },
  { id: 'webp', label: 'WebP', type: 'image/webp', ext: 'webp', lossy: true },
];
const PROXY = 480;
const MAX_PIXELS = 48_000_000;

/** Output size of one picture (iw × ih) for the chosen options. */
export function outSize(iw, ih, o) {
  let w, hh;
  if (o.mode === 'percent') { w = iw * o.pct / 100; hh = ih * o.pct / 100; }
  else if (!o.lock) { w = o.w; hh = o.h; }
  else if (o.last === 'h') { hh = o.h; w = iw * o.h / ih; }
  else { w = o.w; hh = ih * o.w / iw; }
  return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(hh)) };
}

export const webpWorks = () => new Promise(res => {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 2;
    c.toBlob(b => res(!!b && b.type === 'image/webp'), 'image/webp', 0.8);
  } catch (e) { res(false); }
});

function drawTo(canvas, bmp, w, hh, opaque) {
  canvas.width = w; canvas.height = hh;
  const g = canvas.getContext('2d');
  if (opaque) { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, hh); }
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, 0, w, hh);
}
const tick = () => new Promise(r => setTimeout(r, 0));

export function mountConvert({ api, root, opts }) {
  const { h, icon } = api;
  const O = { mode: 'percent', pct: 50, w: 0, h: 0, lock: true, last: 'w', fmt: 'png', q: 85, replace: false };
  const S = { items: [], alive: true, running: false, estSeq: 0, estTimer: 0, webp: true };
  const fmtBytes = api.fmt.fmtBytes;
  const fmtOf = () => FORMATS.find(f => f.id === O.fmt);

  /* ---------- the list ---------- */
  const listEl = h('div.pt-conv__list', { role: 'list', 'aria-label': 'Pictures to convert' });
  const emptyEl = h('div.pt__empty', icon('image'), h('b', { text: 'Pick some pictures' }),
    h('small', { text: 'Choose one or many on the right. Nothing changes until you press Convert.' }));
  const prog = h('progress.pt-conv__progress', { max: 1, value: 0, hidden: true, 'aria-label': 'Conversion progress' });
  const progText = h('div.pt__foot', { role: 'status', 'aria-live': 'polite' });
  const main = h('div.pt__col', h('div.pt__stage.pt-conv__stage', emptyEl, listEl), h('div.pt-conv__progwrap', prog), progText);

  const rowOf = new Map();
  function makeRow(it) {
    const name = h('b.pt-conv__name', { text: it.src.name, title: it.src.name });
    const from = h('span.pt-conv__from', { text: 'Reading…' });
    const to = h('span.pt-conv__to');
    const est = h('span.pt-conv__est', { text: '' });
    const real = h('span.pt-conv__real', { text: '' });
    const row = h('div.pt-conv__row', { role: 'listitem', dataset: { name: it.src.name } },
      name, h('div.pt-conv__cols',
        h('span.pt-conv__col', h('small', { text: 'Original' }), from),
        h('span.pt-conv__col', h('small', { text: 'Output size' }), to),
        h('span.pt-conv__col', h('small', { text: 'Estimated' }), est),
        h('span.pt-conv__col', h('small', { text: 'Result' }), real)));
    rowOf.set(it, { row, from, to, est, real });
    return row;
  }
  function paintRows() {
    emptyEl.hidden = S.items.length > 0;
    listEl.hidden = !S.items.length;
    const fmt = fmtOf();
    for (const it of S.items) {
      const r = rowOf.get(it);
      if (!r) continue;
      if (it.error) { r.from.textContent = it.error; r.to.textContent = ''; continue; }
      if (!it.w) continue;
      r.from.textContent = `${it.w} × ${it.h}${it.bytes ? ` · ${fmtBytes(it.bytes)}` : ''}`;
      const o = outSize(it.w, it.h, O);
      it.out = o;
      r.to.textContent = `${o.w} × ${o.h}`;
      r.to.classList.toggle('is-bad', o.w * o.h > MAX_PIXELS);
      if (o.w * o.h > MAX_PIXELS) r.to.textContent += ' (too big)';
      r.est.textContent = it.est ? `≈ ${fmtBytes(it.est)}` : (it.est === null ? 'n/a' : '…');
    }
    convertBtn.disabled = S.running || !S.items.some(i => i.w && !i.error);
    convertBtn.querySelector('span:last-child').textContent = S.items.length > 1 ? `Convert ${S.items.length} pictures` : 'Convert';
  }
  async function loadInfo(it) {
    try {
      const blob = await blobOfSource(it.src);
      const bmp = await bitmapOf(blob);
      const { w, h: hh } = sizeOfBitmap(bmp);
      if (!w || !hh) throw new Error('No size of its own');
      const k = Math.min(1, PROXY / Math.max(w, hh));
      const proxy = document.createElement('canvas');
      proxy.width = Math.max(1, Math.round(w * k)); proxy.height = Math.max(1, Math.round(hh * k));
      proxy.getContext('2d').drawImage(bmp, 0, 0, proxy.width, proxy.height);
      bmp.close?.();
      it.w = w; it.h = hh; it.bytes = blob.size; it.proxy = proxy;
      if (!O.w && !O.h && S.items[0] === it) { O.w = w; O.h = hh; wIn.value = w; hIn.value = hh; }
    } catch (err) {
      it.error = `Can’t read this picture (${err?.message || 'unknown error'})`;
    }
    if (!S.alive) return;
    paintRows();
    scheduleEstimate();
  }
  function setItems(list) {
    const keep = new Map(S.items.map(i => [i.src.key, i]));
    S.items = list.map(src => keep.get(src.key) || { src, w: 0, h: 0, bytes: 0, est: undefined, proxy: null });
    listEl.replaceChildren(...S.items.map(it => (rowOf.get(it)?.row) || makeRow(it)));
    for (const [it] of [...rowOf]) if (!S.items.includes(it)) rowOf.delete(it);
    for (const it of S.items) if (!it.w && !it.error) loadInfo(it);
    paintRows();
    scheduleEstimate();
  }

  /* ---------- estimate ---------- */
  function scheduleEstimate() {
    clearTimeout(S.estTimer);
    for (const it of S.items) if (it.w) it.est = undefined;
    paintRows();
    S.estTimer = setTimeout(estimate, 220);
  }
  async function estimate() {
    const seq = ++S.estSeq;
    const fmt = fmtOf();
    for (const it of S.items) {
      if (!it.proxy || it.error) continue;
      const o = outSize(it.w, it.h, O);
      const k = Math.min(1, PROXY / Math.max(o.w, o.h));
      const pw = Math.max(1, Math.round(o.w * k)), ph = Math.max(1, Math.round(o.h * k));
      const c = document.createElement('canvas');
      drawTo(c, it.proxy, pw, ph, fmt.id === 'jpeg');
      const blob = await encode(c, fmt.type, O.q / 100);
      if (!S.alive || seq !== S.estSeq) return;
      it.est = blob ? Math.max(1, Math.round(blob.size * (o.w * o.h) / (pw * ph))) : null;
      paintRows();
      await tick();
    }
  }

  /* ---------- convert ---------- */
  async function convert() {
    if (S.running) return;
    const todo = S.items.filter(i => i.w && !i.error);
    if (!todo.length) return;
    if (O.replace) {
      const n = todo.filter(i => i.src.path).length;
      const okay = await api.confirm({
        title: n === 1 ? `Replace “${todo.find(i => i.src.path).src.name}”?` : `Replace ${n} originals?`,
        message: 'Each original picture is overwritten with its converted version (its name may change to match the new format). This can’t be undone.',
        ok: 'Replace originals', danger: true,
      });
      if (!okay || !S.alive) return;
    }
    S.running = true;
    convertBtn.disabled = true;
    prog.hidden = false; prog.max = todo.length; prog.value = 0;
    let done = 0, failed = 0, inBytes = 0, outBytes = 0;
    const fmt = fmtOf();
    for (const it of todo) {
      const r = rowOf.get(it);
      progText.textContent = `Converting ${done + failed + 1} of ${todo.length}: ${it.src.name}`;
      r.real.textContent = 'Working…';
      r.row.classList.remove('is-done', 'is-fail');
      await tick();
      try {
        const o = outSize(it.w, it.h, O);
        if (o.w * o.h > MAX_PIXELS) throw new Error('Too big for this browser');
        const bmp = await bitmapOf(await blobOfSource(it.src));
        const c = document.createElement('canvas');
        drawTo(c, bmp, o.w, o.h, fmt.id === 'jpeg');
        bmp.close?.();
        const blob = await encode(c, fmt.type, O.q / 100);
        c.width = c.height = 0;
        if (!blob) throw new Error(`This browser can’t save ${fmt.label}`);
        let saved;
        if (O.replace && it.src.path && vfs.node(it.src.path)) {
          saved = (await media.replace(it.src.path, blob, { name: `${stemOf(it.src.name)}.${fmt.ext}` })).path;
        } else {
          saved = (await media.save(destFor(it.src), `${stemOf(it.src.name)} (${o.w}×${o.h}).${fmt.ext}`, blob)).path;
        }
        it.real = blob.size; it.savedPath = saved;
        inBytes += it.bytes; outBytes += blob.size;
        const pct = it.bytes ? Math.round((blob.size / it.bytes - 1) * 100) : 0;
        r.real.textContent = `${fmtBytes(blob.size)}${it.bytes ? ` (${pct > 0 ? '+' : ''}${pct}%)` : ''} · ${vfs.baseName(saved)}`;
        r.row.classList.add('is-done');
        r.row.dataset.saved = saved;
        done++;
      } catch (err) {
        r.real.textContent = `Failed: ${err?.message || err}`;
        r.row.classList.add('is-fail');
        failed++;
      }
      prog.value = done + failed;
      if (!S.alive) return;
    }
    S.running = false;
    progText.textContent = `${done} of ${todo.length} converted${failed ? `, ${failed} failed` : ''}${done ? ` · ${fmtBytes(inBytes)} → ${fmtBytes(outBytes)}` : ''}`;
    api.notify({
      app: 'Picture Tools', icon: failed && !done ? 'alert' : 'image',
      title: failed ? `${done} converted, ${failed} failed` : `${done} ${done === 1 ? 'picture' : 'pictures'} converted`,
      message: O.replace ? 'The originals were replaced.' : 'Copies were saved beside the originals.',
      actions: [{ label: 'Show in Files', onClick: () => api.openApp('files', { path: todo.find(i => i.savedPath)?.savedPath || picturesDir() }) }],
    });
    paintRows();
  }

  /* ---------- options ---------- */
  const segBtns = (name, list, get, set) => {
    const btns = list.map(([id, label]) => h('button.pt__segbtn', { type: 'button', role: 'radio', 'aria-checked': String(get() === id), dataset: { v: id },
      onclick: () => { set(id); for (const b of btns) b.setAttribute('aria-checked', String(b.dataset.v === get())); } }, label));
    return h('div.pt__seg', { role: 'radiogroup', 'aria-label': name }, btns);
  };
  const pctOut = h('output', { text: `${O.pct}%` });
  const pctIn = h('input', { type: 'range', min: 5, max: 400, step: 1, value: O.pct, 'aria-label': 'Scale in percent',
    oninput: () => { O.pct = Number(pctIn.value); pctOut.textContent = `${O.pct}%`; pctNum.value = O.pct; scheduleEstimate(); } });
  const pctNum = h('input', { type: 'number', min: 1, max: 1000, step: 1, value: O.pct, 'aria-label': 'Scale percent, exact',
    oninput: () => { const v = clamp(Math.round(Number(pctNum.value) || 1), 1, 1000); O.pct = v; pctIn.value = clamp(v, 5, 400); pctOut.textContent = `${v}%`; scheduleEstimate(); } });
  const pctRow = h('div.pt__group', h('label.pt__slider', h('span', { text: 'Scale' }), pctIn, pctOut), h('label.pt__line', h('span', { text: 'Exact %' }), pctNum));

  const wIn = h('input', { type: 'number', min: 1, max: 16384, step: 1, value: '', placeholder: 'width', 'aria-label': 'Width in pixels',
    oninput: () => { O.w = clamp(Math.round(Number(wIn.value) || 1), 1, 16384); O.last = 'w'; followLock(); scheduleEstimate(); } });
  const hIn = h('input', { type: 'number', min: 1, max: 16384, step: 1, value: '', placeholder: 'height', 'aria-label': 'Height in pixels',
    oninput: () => { O.h = clamp(Math.round(Number(hIn.value) || 1), 1, 16384); O.last = 'h'; followLock(); scheduleEstimate(); } });
  function followLock() {
    const first = S.items.find(i => i.w);
    if (!O.lock || !first) return;
    if (O.last === 'w') { O.h = Math.max(1, Math.round(first.h * O.w / first.w)); hIn.value = O.h; }
    else { O.w = Math.max(1, Math.round(first.w * O.h / first.h)); wIn.value = O.w; }
  }
  const lock = h('button.ibtn.pt-conv__lock', { type: 'button', 'aria-pressed': 'true', 'aria-label': 'Keep the shape (aspect lock)', title: 'Keep the shape',
    onclick: () => { O.lock = !O.lock; lock.setAttribute('aria-pressed', String(O.lock)); lock.replaceChildren(icon(O.lock ? 'lock' : 'unlock')); followLock(); scheduleEstimate(); } }, icon('lock'));
  const pxRow = h('div.pt__group', { hidden: true }, h('div.pt__pair', wIn, lock, hIn, h('span', { text: 'px' })),
    h('small.pt__hint', { text: 'With the lock on, the other side follows, so every picture keeps its own shape.' }));
  const modeSeg = segBtns('Resize by', [['percent', 'Percent'], ['pixels', 'Pixels']], () => O.mode, id => {
    O.mode = id; pctRow.hidden = id !== 'percent'; pxRow.hidden = id !== 'pixels';
    if (id === 'pixels') { const f = S.items.find(i => i.w); if (f && !O.w) { O.w = f.w; O.h = f.h; wIn.value = f.w; hIn.value = f.h; } }
    scheduleEstimate();
  });

  const qOut = h('output', { text: `${O.q}` });
  const qIn = h('input', { type: 'range', min: 1, max: 100, step: 1, value: O.q, 'aria-label': 'Quality for JPG and WebP',
    oninput: () => { O.q = Number(qIn.value); qOut.textContent = String(O.q); scheduleEstimate(); } });
  const qRow = h('label.pt__slider', { hidden: true }, h('span', { text: 'Quality' }), qIn, qOut);
  const webpNote = h('small.pt__warn', { hidden: true, role: 'note', text: 'This browser can’t save WebP pictures, so WebP is turned off. PNG and JPG work.' });
  const fmtSeg = segBtns('Convert to', FORMATS.map(f => [f.id, f.label]), () => O.fmt, id => {
    if (id === 'webp' && !S.webp) { O.fmt = 'png'; for (const b of fmtSeg.children) b.setAttribute('aria-checked', String(b.dataset.v === 'png')); return; }
    O.fmt = id; qRow.hidden = !fmtOf().lossy; scheduleEstimate();
  });
  const replaceBox = h('input', { type: 'checkbox', 'aria-label': 'Replace the originals instead of saving copies', onchange: () => { O.replace = replaceBox.checked; } });
  const picker = pickerView(api, { multi: true, label: 'Pictures to convert', onChange: list => setItems(list) });
  const convertBtn = h('button.btn.btn--primary', { type: 'button', onclick: () => convert() }, icon('refresh'), h('span', { text: 'Convert' }));
  const side = h('div.pt__side',
    picker.el,
    h('div.pt__group', h('b.pt__label', { text: 'Size' }), modeSeg, pctRow, pxRow),
    h('div.pt__group', h('b.pt__label', { text: 'Format' }), fmtSeg, webpNote, qRow),
    h('label.pt__check', replaceBox, h('span', { text: 'Replace the originals (asks first; otherwise copies are saved)' })),
    h('div.pt__actions', convertBtn));
  root.append(h('div.pt__split', main, side));
  paintRows();

  webpWorks().then(ok => {
    if (!S.alive) return;
    S.webp = ok;
    const b = fmtSeg.querySelector('[data-v="webp"]');
    if (!ok) { b.disabled = true; b.title = 'This browser can’t save WebP'; webpNote.hidden = false; }
  });

  const first = opts?.path && sourceOfPath(opts.path);
  if (first) picker.pick(first);

  return () => {
    S.alive = false;
    clearTimeout(S.estTimer);
    picker.destroy();
    for (const it of S.items) if (it.proxy) it.proxy.width = it.proxy.height = 0;
  };
}
