/* ============================================================
   ocr.js — read the text in an image, inside the browser.

   Tesseract.js (WebAssembly) from jsDelivr, loaded on first use —
   about 7 MB the first time (script, engine, English data), cached
   by the browser after that. The image never leaves the machine;
   only the text this returns is ever sent anywhere, by the caller.

   read(canvas, { onProgress }) -> { text, confidence }
     onProgress(0..1, label) while the engine loads and reads
   warm()       start loading early (Lens calls it on open)
   release()    stop the worker and free its memory
   ============================================================ */

const VERSION = '5.1.1';
const SCRIPT = `https://cdn.jsdelivr.net/npm/tesseract.js@${VERSION}/dist/tesseract.min.js`;

let workerP = null;
let progress = null;        /* the current read's callback; the logger is set once */

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the text reader from cdn.jsdelivr.net.'));
    document.head.appendChild(s);
  });
}

function worker() {
  if (workerP) return workerP;
  workerP = (async () => {
    await loadScript(SCRIPT);
    if (!window.Tesseract) throw new Error('The text reader did not start.');
    return window.Tesseract.createWorker('eng', 1, {
      logger: m => {
        if (!progress || typeof m.progress !== 'number') return;
        const label = m.status === 'recognizing text' ? 'Reading text'
          : /load|initializ/i.test(m.status) ? 'Loading the text reader' : 'Preparing';
        progress(m.progress, label);
      },
    });
  })();
  workerP.catch(() => { workerP = null; });   /* let a later call retry */
  return workerP;
}

export function warm() { worker().catch(() => {}); }

export async function release() {
  const p = workerP;
  workerP = null;
  if (!p) return;
  try { (await p).terminate(); } catch (err) { /* already gone */ }
}

/**
 * Screen text is often small and often light-on-dark; Tesseract does best on
 * large dark-on-light text. So: scale small captures up, go greyscale, and
 * invert when the region is mostly dark.
 */
function prepare(src) {
  const w = src.width, h = src.height;
  const scale = Math.max(1, Math.min(3, 1600 / Math.max(w, 1)));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, c.width, c.height);
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) {
    const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = y;
    sum += y;
  }
  /* low-contrast captures (grey on grey): stretch the middle 96% of the grey levels to full range */
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) hist[d[i] | 0]++;
  const n = d.length / 4;
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.02) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= n * 0.02) { hi = v; break; } }
  if (hi - lo > 20 && hi - lo < 200) {
    const k = 255 / (hi - lo);
    sum = 0;
    for (let i = 0; i < d.length; i += 4) { const v = Math.max(0, Math.min(255, (d[i] - lo) * k)); d[i] = d[i + 1] = d[i + 2] = v; sum += v; }
  }
  if (sum / (d.length / 4) < 120) {
    for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = 255 - d[i];
  }
  g.putImageData(img, 0, 0);
  return c;
}

export async function read(canvas, { onProgress } = {}) {
  progress = onProgress || null;
  try {
    onProgress?.(0, 'Loading the text reader');
    const w = await worker();
    const { data } = await w.recognize(prepare(canvas));
    const text = String(data.text || '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return { text, confidence: Math.round(data.confidence || 0) };
  } finally {
    progress = null;
  }
}

export default { read, warm, release };
