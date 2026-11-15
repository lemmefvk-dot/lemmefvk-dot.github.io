/* ============================================================
   mathlab-fractal-worker.js — draws the fractal off the page's thread.

   The window sends { id, mode, cx, cy, scale, w, h, max, palette, c };
   this answers with bands of rows { id, y0, rows, w, data } and then
   { id, done, ms }. A newer request (higher id) abandons the old one
   between bands, so dragging never waits for a picture nobody wants.
   ============================================================ */
import { renderRows } from '../core/fractal.js';

let latest = 0;
const BAND = 24;

self.onmessage = async e => {
  const job = e.data;
  if (!job || typeof job.id !== 'number') return;
  latest = job.id;
  const t0 = performance.now();
  for (let y = 0; y < job.h; y += BAND) {
    await new Promise(r => setTimeout(r, 0));           /* lets a newer request arrive */
    if (job.id !== latest) return;
    const y1 = Math.min(job.h, y + BAND);
    const data = renderRows(job, y, y1);
    self.postMessage({ id: job.id, y0: y, rows: y1 - y, w: job.w, data }, [data.buffer]);
  }
  if (job.id === latest) self.postMessage({ id: job.id, done: true, ms: Math.round(performance.now() - t0) });
};
